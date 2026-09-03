import type { BaseChannel } from "./channels/base";
import { BinaryOperatorAggregate } from "./channels/binop";
import { LastValue } from "./channels/lastValue";
import { END, START } from "./constants";
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
 * compile 결과. 실행(stream/invoke)만 담당한다.
 *
 * superstep(BSP): 활성 노드들을 병렬 실행하고, 쓰기는 버퍼했다 스텝 경계에서 한 번에 반영.
 * 같은 채널로 온 여러 쓰기는 리듀서가 fold한다.
 * 다음 활성 노드는 정적 엣지 + 조건부 라우터(V5)의 합집합으로 계산한다.
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
   * source(노드 또는 START)에서 갈 다음 노드 집합 — 정적 엣지 + 조건부 라우터의 합집합(END 제외).
   * 라우터는 현재 상태를 보고 노드명(들)/END를 고른다. 모르는 노드를 반환하면 즉시 에러.
   * langgraph 대응: 정적 엣지의 branch:to 트리거 + Branch 실행(V7에서 채널로 통일).
   */
  private async nextTargets(source: string, state: S): Promise<Set<string>> {
    const out = new Set<string>();
    for (const to of this.edges.get(source) ?? []) {
      if (to !== END) {
        out.add(to);
      }
    }
    for (const router of this.branches.get(source) ?? []) {
      const result = await router(state);
      for (const to of Array.isArray(result) ? result : [result]) {
        if (to === END) {
          continue;
        }
        if (!this.nodes.has(to)) {
          throw new Error(`라우터가 모르는 노드 '${to}'를 반환했다 (source='${source}').`);
        }
        out.add(to);
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

    // Plan: 첫 활성 노드 = START의 아웃엣지/라우터 대상들(입력 상태로 라우팅).
    let active = await this.nextTargets(START, readChannels<S>(channels));

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
      const stateNow = readChannels<S>(channels);

      yield {
        step,
        nodes: names,
        state: stateNow,
        channels: snapshotChannels(channels),
      };

      // Plan(다음): 실행한 노드들의 아웃엣지/라우터 대상(END 제외), 중복 제거.
      // 라우터는 이 스텝 반영 직후 상태(stateNow)를 보고 다음 노드를 고른다.
      const next = new Set<string>();
      for (const name of names) {
        for (const to of await this.nextTargets(name, stateNow)) {
          next.add(to);
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
