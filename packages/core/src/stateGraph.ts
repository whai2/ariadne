import type { BaseChannel } from "./channels/base";
import { BinaryOperatorAggregate } from "./channels/binop";
import { LastValue } from "./channels/lastValue";
import { END, START } from "./constants";

/** 상태 키의 병합 정책. reducer가 있으면 누적 채널, 없으면 LastValue. langgraph의 Annotated 대응. */
export interface ChannelSpec<T> {
  reducer?: (current: T, update: T) => T;
}

/** 상태 스키마: 키별 채널 정책. 선언 안 한 키는 LastValue로 동적 생성. */
export type StateSchema<S> = { [K in keyof S]?: ChannelSpec<S[K]> };

/** 스펙 하나를 채널로 만든다. reducer가 있으면 BinaryOperatorAggregate, 없으면 LastValue. */
function makeChannel(spec: ChannelSpec<unknown> | undefined): BaseChannel {
  if (spec?.reducer) {
    return new BinaryOperatorAggregate(spec.reducer);
  }
  return new LastValue();
}

/** 채널들에서 값을 모아 평범한 상태 객체로 만든다. 비어있는 채널은 뺀다. */
function readChannels<S>(channels: Map<string, BaseChannel>): S {
  const out: Record<string, unknown> = {};
  for (const [key, ch] of channels) {
    if (ch.isAvailable()) {
      out[key] = ch.get();
    }
  }
  return out as S;
}

/**
 * 한 superstep에 모인 쓰기를 채널에 반영한다(Update 단계).
 * writes: 채널키 -> 그 스텝에 그 채널로 온 모든 값. 채널이 여러 값을 fold(리듀서)하거나,
 * LastValue면 2개 이상일 때 InvalidUpdateError(→ 병렬엔 리듀서가 필요). 갱신된 채널 키를 반환.
 * langgraph 대응: pregel/_algo.py 의 apply_writes.
 */
function applyWrites(channels: Map<string, BaseChannel>, writes: Map<string, unknown[]>): string[] {
  const updated: string[] = [];
  for (const [key, values] of writes) {
    let ch = channels.get(key);
    if (ch === undefined) {
      ch = new LastValue();
      channels.set(key, ch);
    }
    if (ch.update(values)) {
      updated.push(key);
    }
  }
  return updated;
}

/** 여러 노드가 이 스텝에 반환한 부분 상태들을 채널키별 값 목록으로 모은다. */
function collectWrites(updates: object[]): Map<string, unknown[]> {
  const writes = new Map<string, unknown[]>();
  for (const update of updates) {
    for (const [key, value] of Object.entries(update)) {
      const arr = writes.get(key) ?? [];
      arr.push(value);
      writes.set(key, arr);
    }
  }
  return writes;
}

/** 채널들의 관찰용 스냅샷(타입/가용성/값). Studio가 이걸로 채널 패널을 그린다. */
function snapshotChannels(channels: Map<string, BaseChannel>): ChannelSnapshot[] {
  return [...channels].map(([key, ch]) => {
    const available = ch.isAvailable();
    return available
      ? { key, type: ch.kind, available, value: ch.get() }
      : { key, type: ch.kind, available };
  });
}

/**
 * 노드 함수: 현재 상태를 받아 "갱신할 부분 상태"를 반환한다.
 * 반환값은 채널에 반영된다(리듀서면 누적, 아니면 덮어쓰기). async 허용.
 */
export type NodeFn<S> = (state: S) => Partial<S> | Promise<Partial<S>>;

/** 그래프의 구조(노드/엣지). Studio가 그림을 그릴 때 읽는다. langgraph 대응: get_graph(). */
export interface GraphView {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

/** 한 채널의 관찰용 스냅샷(Studio가 채널 패널에 그린다). */
export interface ChannelSnapshot {
  key: string;
  /** 채널 종류(예: "LastValue", "BinaryOperatorAggregate"). */
  type: string;
  /** 값이 있으면 true(비어있지 않음). */
  available: boolean;
  /** available일 때만 채워진다. */
  value?: unknown;
}

/** 한 superstep 실행 결과: 그 스텝에 (병렬로) 실행된 노드들 + 직후 상태/채널. langgraph 대응: stream(). */
export interface StepUpdate<S> {
  /** superstep 번호(0부터). */
  step: number;
  /** 이 superstep에 병렬 실행된 노드들. */
  nodes: string[];
  state: S;
  channels: ChannelSnapshot[];
}

/**
 * StateGraph (V4 · superstep / BSP).
 *
 * - 노드는 아웃엣지를 **여러 개** 가질 수 있다(분기/팬아웃).
 * - 실행 = Plan→Execute→Update **superstep**: 활성 노드들을 병렬 실행하고, 쓰기는 버퍼했다
 *   스텝 경계에서 한 번에 반영. 같은 채널로 온 여러 쓰기는 리듀서가 fold한다.
 *
 * langgraph 대응: graph/state.py(StateGraph) + pregel 루프.
 */
export class StateGraph<S extends object> {
  /** 노드 이름 -> 실행 함수 */
  private readonly nodes = new Map<string, NodeFn<S>>();
  /** 아웃엣지: from -> [targets] (V4부터 여러 개 가능) */
  private readonly edges = new Map<string, string[]>();

  /** @param schema 키별 채널 정책(리듀서 등). 생략 시 모든 키가 LastValue. */
  constructor(private readonly schema: StateSchema<S> = {}) {}

  addNode(name: string, fn: NodeFn<S>): this {
    if (name === START || name === END) {
      throw new Error(`'${name}'는 예약된 이름이라 노드로 쓸 수 없다.`);
    }
    if (this.nodes.has(name)) {
      throw new Error(`노드 '${name}'가 이미 있다.`);
    }
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this {
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

  /** 검증 후 실행 가능한 스냅샷을 넘긴다. */
  compile(): CompiledGraph<S> {
    if (!this.edges.has(START)) {
      throw new Error("진입 엣지가 없다: addEdge(START, ...)가 필요하다.");
    }
    return new CompiledGraph(new Map(this.nodes), new Map(this.edges), this.schema);
  }
}

/** compile 결과. 실행(invoke)만 담당한다. */
export class CompiledGraph<S extends object> {
  constructor(
    private readonly nodes: Map<string, NodeFn<S>>,
    private readonly edges: Map<string, string[]>,
    private readonly schema: StateSchema<S> = {},
  ) {}

  /** 그래프 구조를 읽어 반환한다(그림용). Studio가 이걸로 노드/엣지를 그린다. */
  getGraph(): GraphView {
    return {
      nodes: [...this.nodes.keys()],
      edges: [...this.edges.entries()].flatMap(([from, tos]) => tos.map((to) => ({ from, to }))),
    };
  }

  /**
   * superstep(BSP)으로 실행한다. 매 superstep마다 `{ step, nodes, state, channels }`를 yield하고,
   * 끝나면 최종 상태를 return한다.
   *
   * 한 스텝: Plan(활성 노드 결정) → Execute(같은 스냅샷을 읽고 병렬 실행, 쓰기 버퍼)
   *        → Update(applyWrites로 한 번에 반영, 리듀서가 병렬 쓰기 fold).
   * langgraph 대응: stream() + pregel 루프.
   */
  async *stream(input: S): AsyncGenerator<StepUpdate<S>, S> {
    // 채널 초기화: 스키마 선언 키는 정책대로, 나머지는 applyWrites가 LastValue로.
    const channels = new Map<string, BaseChannel>();
    for (const [key, spec] of Object.entries(this.schema)) {
      channels.set(key, makeChannel(spec as ChannelSpec<unknown> | undefined));
    }
    // 입력 반영(각 키 값 1개).
    applyWrites(
      channels,
      new Map<string, unknown[]>(
        Object.entries(input).map(([k, v]) => [k, [v]] as [string, unknown[]]),
      ),
    );

    // Plan: 첫 활성 노드 = START의 아웃엣지 대상들.
    let active = new Set(this.edges.get(START) ?? []);

    const limit = 100;
    let step = 0;

    while (active.size > 0) {
      if (step >= limit) {
        throw new Error(`재귀 한도(${limit})를 초과했다.`);
      }
      // 결정적 순서(이름 정렬) — 리듀서 fold 순서를 고정.
      const names = [...active].sort();

      // Execute: 모두 같은 스냅샷을 읽고(프리즈) 병렬 실행. 쓰기는 버퍼(반환값).
      const snapshot = readChannels<S>(channels);
      const updates = await Promise.all(
        names.map((name) => {
          const node = this.nodes.get(name);
          if (node === undefined) {
            throw new Error(`노드 '${name}'가 없다.`);
          }
          return node(snapshot);
        }),
      );

      // Update: 모아서 한 번에 반영. 같은 채널로 온 여러 값은 리듀서가 fold.
      applyWrites(channels, collectWrites(updates));

      yield {
        step,
        nodes: names,
        state: readChannels<S>(channels),
        channels: snapshotChannels(channels),
      };

      // Plan(다음): 실행한 노드들의 아웃엣지 대상(END 제외), 중복 제거.
      const next = new Set<string>();
      for (const name of names) {
        for (const to of this.edges.get(name) ?? []) {
          if (to !== END) {
            next.add(to);
          }
        }
      }
      active = next;
      step++;
    }

    return readChannels<S>(channels);
  }

  /** stream을 끝까지 소비하고 최종 상태만 반환한다. (invoke = stream의 마지막) */
  async invoke(input: S): Promise<S> {
    const gen = this.stream(input);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value;
  }
}
