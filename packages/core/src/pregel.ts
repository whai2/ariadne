import type { BaseChannel } from "./channels/base";
import { BinaryOperatorAggregate } from "./channels/binop";
import { LastValue } from "./channels/lastValue";
import { END, START } from "./constants";
import { Send } from "./send";
import type {
  ChannelSnapshot,
  ChannelSpec,
  GraphView,
  NodeFn,
  Router,
  StateSchema,
  StepUpdate,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 순수 알고리즘 (langgraph 대응: pregel/_algo.py)
// 채널이 유일한 공유 가변 상태이고, 이 함수들이 그 상태를 읽고/모으고/반영한다.
// ─────────────────────────────────────────────────────────────────────────────

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
 * 실행 시작 시 채널을 준비한다: 스키마 선언 키는 정책대로 만들고, 입력을 각 키 1개 쓰기로 주입.
 * 스키마에 없는 입력 키는 applyWrites가 LastValue로 동적 생성한다.
 */
function initChannels<S extends object>(
  schema: StateSchema<S>,
  input: S,
): Map<string, BaseChannel> {
  const channels = new Map<string, BaseChannel>();
  for (const [key, spec] of Object.entries(schema)) {
    channels.set(key, makeChannel(spec as ChannelSpec<unknown> | undefined));
  }
  applyWrites(
    channels,
    new Map<string, unknown[]>(
      Object.entries(input).map(([k, v]) => [k, [v]] as [string, unknown[]]),
    ),
  );
  return channels;
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행기 (langgraph 대응: pregel/_loop.py)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 스케줄된 실행 단위(V6). 노드는 "정의"이고, 태스크는 그 노드의 "한 번의 실행"이다.
 * - PULL(`arg` 없음): 엣지/라우터가 깨운 노드. 공유 상태 스냅샷을 입력으로 받는다.
 * - PUSH(`arg` 있음): Send가 만든 태스크. 자기 payload(`arg.value`)를 입력으로 받는다.
 * `arg`를 `{ value }`로 감싸는 건 payload가 undefined여도 PULL과 구분하기 위해서다.
 * langgraph 대응: PregelExecutableTask(name+input), path (PULL,name)/(PUSH,idx).
 */
type Task = { node: string; arg?: { value: unknown } };

/**
 * 한 스텝에 모인 태스크들에서 PULL은 노드별 1개로 중복 제거(팬인), PUSH는 모두 유지.
 * PUSH는 같은 노드라도 payload가 달라 각각 별개 실행이므로 합치면 안 된다.
 */
function dedupePullTasks(tasks: Task[]): Task[] {
  const seenPull = new Set<string>();
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.arg !== undefined) {
      out.push(t); // PUSH: 항상 유지
    } else if (!seenPull.has(t.node)) {
      seenPull.add(t.node);
      out.push(t); // PULL: 노드별 첫 번째만
    }
  }
  return out;
}

/**
 * compile 결과. 실행(stream/invoke)만 담당한다.
 *
 * superstep(BSP): 활성 태스크들을 병렬 실행하고, 쓰기는 버퍼했다 스텝 경계에서 한 번에 반영.
 * 같은 채널로 온 여러 쓰기는 리듀서가 fold한다.
 * 다음 활성 태스크는 정적 엣지(PULL) + 라우터 결과(PULL 또는 Send→PUSH)의 합으로 계산한다.
 */
export class CompiledGraph<S extends object> {
  constructor(
    private readonly nodes: Map<string, NodeFn<S>>,
    private readonly edges: Map<string, string[]>,
    private readonly schema: StateSchema<S> = {},
    private readonly branches: Map<string, Router<S>[]> = new Map(),
  ) {}

  /** 그래프 구조를 읽어 반환한다(그림용). Studio가 이걸로 노드/엣지를 그린다. */
  getGraph(): GraphView {
    return {
      nodes: [...this.nodes.keys()],
      edges: [...this.edges.entries()].flatMap(([from, tos]) => tos.map((to) => ({ from, to }))),
    };
  }

  /**
   * source(노드 또는 START)에서 나가는 다음 태스크들 — 정적 엣지 + 라우터 결과(END 제외).
   * - 정적 엣지, 라우터가 반환한 노드명 → PULL 태스크
   * - 라우터가 반환한 Send → PUSH 태스크(payload 실음) — 리스트 개수만큼 동적 팬아웃(V6)
   * 모르는 노드를 가리키면 즉시 에러. langgraph 대응: prepare_next_tasks의 PULL/PUSH.
   */
  private async nextTasks(source: string, state: S): Promise<Task[]> {
    const out: Task[] = [];
    for (const to of this.edges.get(source) ?? []) {
      if (to !== END) {
        out.push({ node: to });
      }
    }
    for (const router of this.branches.get(source) ?? []) {
      const result = await router(state);
      for (const target of Array.isArray(result) ? result : [result]) {
        if (target instanceof Send) {
          if (!this.nodes.has(target.node)) {
            throw new Error(`Send가 모르는 노드 '${target.node}'를 가리킨다 (source='${source}').`);
          }
          out.push({ node: target.node, arg: { value: target.arg } }); // PUSH
        } else {
          if (target === END) {
            continue;
          }
          if (!this.nodes.has(target)) {
            throw new Error(`라우터가 모르는 노드 '${target}'를 반환했다 (source='${source}').`);
          }
          out.push({ node: target }); // PULL
        }
      }
    }
    return out;
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
    const channels = initChannels(this.schema, input);

    // Plan: 첫 활성 태스크 = START의 아웃엣지/라우터 대상들(입력 상태로 라우팅).
    let active = await this.nextTasks(START, readChannels<S>(channels));

    const limit = 100;
    let step = 0;

    while (active.length > 0) {
      if (step >= limit) {
        throw new Error(`재귀 한도(${limit})를 초과했다.`);
      }
      // 결정적 순서: 노드 이름 안정 정렬(같은 노드의 PUSH들은 emit 순서 유지) — fold 순서 고정.
      const tasks = [...active].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));

      // Execute: PULL은 같은 스냅샷을, PUSH는 자기 payload를 입력으로 병렬 실행. 쓰기는 버퍼.
      const snapshot = readChannels<S>(channels);
      const updates = await Promise.all(
        tasks.map((task) => {
          const node = this.nodes.get(task.node);
          if (node === undefined) {
            throw new Error(`노드 '${task.node}'가 없다.`);
          }
          return node(task.arg ? (task.arg.value as S) : snapshot);
        }),
      );

      // Update: 모아서 한 번에 반영. 같은 채널로 온 여러 값은 리듀서가 fold.
      applyWrites(channels, collectWrites(updates));
      const stateNow = readChannels<S>(channels);

      yield {
        step,
        nodes: tasks.map((t) => t.node),
        state: stateNow,
        channels: snapshotChannels(channels),
      };

      // Plan(다음): 실행한 각 태스크의 노드에서 나가는 태스크(END 제외).
      // 라우터는 이 스텝 반영 직후 상태(stateNow)를 본다. PULL은 노드별 중복 제거, PUSH는 유지.
      const produced: Task[] = [];
      for (const task of tasks) {
        for (const t of await this.nextTasks(task.node, stateNow)) {
          produced.push(t);
        }
      }
      active = dedupePullTasks(produced);
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
