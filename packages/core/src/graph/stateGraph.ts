import type { BaseChannel } from "../channels/base";
import { BinaryOperatorAggregate } from "../channels/binop";
import { EphemeralValue } from "../channels/ephemeralValue";
import { LastValue } from "../channels/lastValue";
import { NamedBarrierValue } from "../channels/namedBarrier";
import { Topic } from "../channels/topic";
import { branchTo, END, joinTo, START, TASKS } from "../constants";
import {
  type ChannelWriteEntry,
  CompiledGraph,
  type PregelNode,
  type PregelSpec,
  type Writer,
} from "../pregel";
import { Send } from "../send";
import { Command } from "./command";
import type { ChannelSpec, NodeFn, Router, RouteTarget, StateSchema } from "./types";

/** 스펙 하나를 상태 채널로 만든다. reducer가 있으면 BinaryOperatorAggregate, 없으면 LastValue. */
function makeStateChannel(spec: ChannelSpec<unknown> | undefined): BaseChannel {
  if (spec?.reducer) {
    return new BinaryOperatorAggregate(spec.reducer);
  }
  return new LastValue();
}

/**
 * 노드 출력 → 상태 채널 쓰기. `Command`면 그 안의 update만 꺼낸다.
 * 엔진은 출력을 `unknown`으로 넘긴다 — **"부분 상태냐 Command냐"를 아는 건 여기뿐**이다.
 */
function updateWrites(output: unknown): ChannelWriteEntry[] {
  const update = output instanceof Command ? output.update : output;
  return Object.entries((update ?? {}) as object).map(([channel, value]) => ({ channel, value }));
}

/**
 * 행선지(노드명/END/Send) → **제어 채널 쓰기**. V7의 핵심 낮추기다.
 * - 노드명 → `branch:to:<노드>`에 쓴다(그 노드가 다음 스텝에 깨어남).
 * - `END` → 아무 데도 안 쓴다(아무도 안 깨어나면 그게 종료다).
 * - `Send` → `TASKS`에 쌓는다(다음 스텝의 PUSH 태스크).
 * 정적 엣지·조건부 엣지·`Command.goto`가 전부 이 함수 하나로 수렴한다.
 * langgraph 대응: graph/state.py 의 `_control_branch` / `get_writes`.
 */
function controlWrites(
  targets: readonly RouteTarget[],
  source: string,
  known: ReadonlySet<string>,
): ChannelWriteEntry[] {
  const writes: ChannelWriteEntry[] = [];
  for (const target of targets) {
    if (target instanceof Send) {
      if (!known.has(target.node)) {
        throw new Error(`Send가 모르는 노드 '${target.node}'를 가리킨다 (source='${source}').`);
      }
      writes.push({ channel: TASKS, value: target });
    } else if (target !== END) {
      if (!known.has(target)) {
        throw new Error(`모르는 노드 '${target}'로 가려 한다 (source='${source}').`);
      }
      writes.push({ channel: branchTo(target), value: null });
    }
  }
  return writes;
}

/**
 * StateGraph (V7 · Command + Pregel 정합) — 그래프를 **선언**하는 빌더.
 *
 * 순수 sugar다: `compile()`이 노드를 `PregelNode`(트리거·bound·writers)로, 엣지·라우터·
 * `Command.goto`를 전부 **채널 쓰기**로 낮춘다. 그 뒤 실행기(`CompiledGraph`)는 엣지가
 * 뭔지 모른 채 "갱신된 트리거 채널 → 구독한 정점" 규칙만 돌린다. langgraph 대응: graph/state.py.
 *
 * - 노드는 아웃엣지를 **여러 개** 가질 수 있다(분기/팬아웃). (V4)
 * - `addConditionalEdges(source, router)` — router(state)가 런타임에 대상을 고른다. (V5)
 * - 라우터가 `Send(node, arg)`를 반환하면 런타임 개수만큼 동적 병렬 처리. (V6)
 * - 노드가 `Command({update, goto})`를 반환하면 상태 갱신과 행선지를 한 번에. (V7)
 * - `addEdge([b, c], d)` — 다중소스 엣지는 **배리어**라 b·c가 다 와야 d가 돈다. (V7)
 */
export class StateGraph<S extends object> {
  /** 노드 이름 -> 실행 함수 */
  private readonly nodes = new Map<string, NodeFn<S, never>>();
  /** 정적 아웃엣지: from -> [targets] (V4부터 여러 개 가능) */
  private readonly edges = new Map<string, string[]>();
  /** 조건부 아웃엣지: from -> [routers]. 실행 시 각 router(state)가 대상을 고른다. (V5) */
  private readonly branches = new Map<string, Router<S>[]>();
  /** 다중소스 엣지: starts가 **전부** 도착해야 end가 돈다. (V7) */
  private readonly waitingEdges: Array<{ starts: string[]; end: string }> = [];

  /** @param schema 키별 채널 정책(리듀서 등). 생략 시 모든 키가 LastValue. */
  constructor(private readonly schema: StateSchema<S> = {}) {}

  /**
   * 노드를 등록한다. `I`는 이 노드가 받는 입력 타입 — 기본은 상태 전체(`S`)다.
   * `Send`로만 도는 워커는 payload를 받으므로 `addNode<number>("square", (n) => ...)`처럼
   * 지정하면 캐스팅 없이 타입이 맞는다. (V7)
   */
  addNode<I = S>(name: string, fn: NodeFn<S, I>): this {
    if (name === START || name === END) {
      throw new Error(`'${name}'는 예약된 이름이라 노드로 쓸 수 없다.`);
    }
    if (this.nodes.has(name)) {
      throw new Error(`노드 '${name}'가 이미 있다.`);
    }
    this.nodes.set(name, fn);
    return this;
  }

  /**
   * 엣지를 잇는다. `from`이 **배열이면 다중소스 엣지**(join): 그 노드들이 전부 도착해야
   * `to`가 한 번 돈다 — 도착 스텝이 서로 달라도 기다린다(`NamedBarrierValue`). (V7)
   * 개별 엣지를 여러 번 거는 것과는 다르다: 그건 먼저 온 쪽이 곧바로 `to`를 깨운다.
   */
  addEdge(from: string | string[], to: string): this {
    if (Array.isArray(from)) {
      return this.addWaitingEdge(from, to);
    }
    if (from === END) {
      throw new Error("END에서 나가는 엣지는 만들 수 없다.");
    }
    if (from !== START && !this.nodes.has(from)) {
      throw new Error(`엣지 출발 노드 '${from}'가 없다.`);
    }
    if (to !== END && !this.nodes.has(to)) {
      throw new Error(`엣지 도착 노드 '${to}'가 없다.`);
    }
    const outs = this.edges.get(from) ?? [];
    if (!outs.includes(to)) {
      outs.push(to);
    }
    this.edges.set(from, outs);
    return this;
  }

  private addWaitingEdge(starts: string[], end: string): this {
    if (starts.length === 0) {
      throw new Error("다중소스 엣지의 출발 노드가 비어있다.");
    }
    for (const start of starts) {
      if (!this.nodes.has(start)) {
        throw new Error(`엣지 출발 노드 '${start}'가 없다.`);
      }
    }
    if (!this.nodes.has(end)) {
      throw new Error(`다중소스 엣지의 도착 노드 '${end}'가 없다(END는 기다릴 게 없다).`);
    }
    this.waitingEdges.push({ starts: [...starts], end });
    return this;
  }

  /**
   * 조건부 엣지: `source`가 실행된 뒤 `router(state)`가 다음 노드(들)를 고른다. (V5)
   * router는 노드명 하나·여러 개(팬아웃)·`END`·`Send`를 반환할 수 있다. 정적 엣지와 공존 가능.
   * router가 보는 상태는 **source 자신의 쓰기까지만 반영된 로컬 뷰**다(같은 스텝의 다른
   * 노드 쓰기는 안 보임 — BSP). langgraph 대응: graph/state.py:982 add_conditional_edges.
   */
  addConditionalEdges(source: string, router: Router<S>): this {
    if (source === END) {
      throw new Error("END에서 나가는 엣지는 만들 수 없다.");
    }
    if (source !== START && !this.nodes.has(source)) {
      throw new Error(`조건부 엣지 출발 노드 '${source}'가 없다.`);
    }
    const routers = this.branches.get(source) ?? [];
    routers.push(router);
    this.branches.set(source, routers);
    return this;
  }

  /**
   * 검증 후 그래프를 Pregel 구조로 **낮춘다**(V7).
   * 노드 → `PregelNode`(트리거 채널 구독 + writers), 엣지/라우터/join → 채널 + writer.
   */
  compile(): CompiledGraph<S> {
    if (!this.edges.has(START) && !this.branches.has(START)) {
      throw new Error(
        "진입 엣지가 없다: addEdge(START, ...) 또는 addConditionalEdges(START, ...)가 필요하다.",
      );
    }
    const known = new Set(this.nodes.keys());

    // ── 채널: 상태(스키마) + 노드별 트리거 + join 배리어 + TASKS ──
    const channelFactories = new Map<string, () => BaseChannel>();
    const controlChannels = new Set<string>();
    for (const [key, spec] of Object.entries(this.schema)) {
      channelFactories.set(key, () => makeStateChannel(spec as ChannelSpec<unknown> | undefined));
    }
    for (const name of known) {
      const trigger = branchTo(name);
      channelFactories.set(trigger, () => new EphemeralValue());
      controlChannels.add(trigger);
    }
    channelFactories.set(TASKS, () => new Topic<Send>());
    controlChannels.add(TASKS);

    // ── 정점: 트리거 하나 + 자기 출력을 낮추는 writer 하나로 시작 ──
    const nodes = new Map<string, PregelNode<S>>();
    for (const [name, fn] of this.nodes) {
      nodes.set(name, {
        triggers: [branchTo(name)],
        bound: fn,
        writers: [
          (output) => [...updateWrites(output), ...controlWrites(commandGoto(output), name, known)],
        ],
      });
    }

    // ── 정적 엣지: 출발 노드에 "도착지 트리거를 쓴다"는 writer를 하나 더 붙인다 ──
    const startWriters: Writer<S>[] = [];
    for (const [from, tos] of this.edges) {
      const targets = tos.filter((to) => to !== END);
      if (targets.length === 0) {
        continue;
      }
      const writer: Writer<S> = () => controlWrites(targets, from, known);
      if (from === START) {
        startWriters.push(writer);
      } else {
        nodes.get(from)?.writers.push(writer);
      }
    }

    // ── 다중소스 엣지: 배리어 채널을 만들고, 출발 노드들은 자기 이름을 쓴다 ──
    for (const { starts, end } of this.waitingEdges) {
      const channel = joinTo(starts, end);
      const names = new Set(starts);
      channelFactories.set(channel, () => new NamedBarrierValue(names));
      controlChannels.add(channel);
      nodes.get(end)?.triggers.push(channel);
      for (const start of starts) {
        nodes.get(start)?.writers.push(() => [{ channel, value: start }]);
      }
    }

    // ── 조건부 엣지: 라우터를 writer로. 로컬 읽기(자기 쓰기 반영)로 상태를 본다 ──
    for (const [from, routers] of this.branches) {
      for (const router of routers) {
        const writer: Writer<S> = async (_output, read) => {
          const result = await router(read());
          return controlWrites(Array.isArray(result) ? result : [result], from, known);
        };
        if (from === START) {
          startWriters.push(writer);
        } else {
          nodes.get(from)?.writers.push(writer);
        }
      }
    }

    const spec: PregelSpec<S> = {
      nodes,
      startWriters,
      channelFactories,
      controlChannels,
      view: {
        nodes: [...known],
        edges: [
          ...[...this.edges].flatMap(([from, tos]) => tos.map((to) => ({ from, to }))),
          ...this.waitingEdges.flatMap(({ starts, end }) =>
            starts.map((from) => ({ from, to: end })),
          ),
        ],
      },
    };
    return new CompiledGraph(spec);
  }
}

/** `Command`가 아니면 행선지가 없다(제어 흐름은 엣지가 담당). */
function commandGoto(output: unknown): readonly RouteTarget[] {
  return output instanceof Command ? output.goto : [];
}
