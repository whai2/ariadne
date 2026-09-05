import type { BaseChannel } from "./channels/base";
import { LastValue } from "./channels/lastValue";
import { TASKS } from "./constants";
import type { ChannelWriteEntry, PregelNode, Writer } from "./pregelNode";
import type { Send } from "./send";
import type { ChannelSnapshot, GraphView, StepUpdate } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 순수 알고리즘 (langgraph 대응: pregel/_algo.py)
// 채널이 유일한 공유 가변 상태이고, 이 함수들이 그 상태를 읽고/모으고/반영한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 채널 맵. 상태 채널 + 제어 채널(트리거·배리어·TASKS)이 한 그릇에 산다. */
type Channels = Map<string, BaseChannel>;

/**
 * 상태 채널들에서 값을 모아 평범한 상태 객체로 만든다(Read 단계).
 * 제어 채널은 상태가 아니므로 뺀다 — 노드도 Studio도 `branch:to:*`를 볼 일이 없다.
 * langgraph 대응: pregel/_read.py 의 ChannelRead.
 */
function readChannels<S>(channels: Channels, control: ReadonlySet<string>): S {
  const out: Record<string, unknown> = {};
  for (const [key, ch] of channels) {
    if (!control.has(key) && ch.isAvailable()) {
      out[key] = ch.get();
    }
  }
  return out as S;
}

/**
 * 한 superstep에 모인 쓰기를 채널에 반영한다(Update 단계).
 * 채널키별로 값을 모아 한 번에 `update` — 여러 값이 오면 리듀서가 fold하고,
 * LastValue면 `InvalidUpdateError`(→ 병렬엔 리듀서가 필요). 모르는 키는 LastValue로 만든다.
 * **갱신되고 값이 생긴** 채널 키를 반환한다 — 이게 다음 스텝의 스케줄링 입력이다.
 * langgraph 대응: pregel/_algo.py 의 apply_writes.
 */
function applyWrites(channels: Channels, writes: readonly ChannelWriteEntry[]): Set<string> {
  const grouped = new Map<string, unknown[]>();
  for (const { channel, value } of writes) {
    const values = grouped.get(channel) ?? [];
    values.push(value);
    grouped.set(channel, values);
  }
  const updated = new Set<string>();
  for (const [key, values] of grouped) {
    let ch = channels.get(key);
    if (ch === undefined) {
      ch = new LastValue();
      channels.set(key, ch);
    }
    // 배리어는 다 모이기 전엔 update가 true여도 available이 아니다 → 아직 못 깨운다.
    if (ch.update(values) && ch.isAvailable()) {
      updated.add(key);
    }
  }
  return updated;
}

/**
 * 이번 스텝에 아무도 안 쓴 채널에 "새 스텝이 시작됐다"를 통지한다(빈 업데이트).
 * `EphemeralValue`/`Topic`은 여기서 스스로 비워져 **트리거가 딱 1스텝만 살게** 된다.
 * 상태 채널(LastValue/리듀서)엔 no-op이라 상태는 그대로 남는다.
 * langgraph 대응: apply_writes 끝의 "Channels that weren't updated ... notified of a new step".
 */
function expireStale(channels: Channels, updated: ReadonlySet<string>): void {
  for (const [key, ch] of channels) {
    if (!updated.has(key) && ch.isAvailable()) {
      ch.update([]);
    }
  }
}

/**
 * 스케줄된 실행 단위. 노드는 "정의"이고, 태스크는 그 노드의 "한 번의 실행"이다.
 * - PULL(`arg` 없음): 트리거 채널이 깨운 노드. 공유 상태 스냅샷을 입력으로 받는다.
 * - PUSH(`arg` 있음): `TASKS`에 쌓인 Send가 만든 태스크. 자기 payload를 입력으로 받는다.
 * langgraph 대응: PregelExecutableTask, path (PULL,name)/(PUSH,idx).
 */
interface Task<S> {
  name: string;
  node: PregelNode<S>;
  arg?: { value: unknown };
}

/**
 * 다음에 실행할 태스크들을 고른다(Plan 단계).
 *
 * V6까지는 "직전에 실행된 노드들의 아웃엣지"를 엔진이 직접 훑었다. V7은 **구독**이다:
 * 각 정점이 자기 트리거 채널을 보고 있고, 그 채널에 값이 있으면 깨어난다. 스케줄러는
 * 엣지·라우터·Send가 뭔지 모른다 — 아는 건 "채널에 값이 있나"뿐이다.
 *
 * PULL 중복 제거도 사라졌다: 같은 노드로 여러 엣지가 들어와도 트리거 채널은 하나라
 * **채널이 대신 접어준다**. langgraph 대응: pregel/_algo.py 의 prepare_next_tasks.
 */
function prepareNextTasks<S>(channels: Channels, nodes: Map<string, PregelNode<S>>): Task<S>[] {
  const tasks: Task<S>[] = [];
  for (const [name, node] of nodes) {
    if (node.triggers.some((trigger) => channels.get(trigger)?.isAvailable() === true)) {
      tasks.push({ name, node });
    }
  }
  const queue = channels.get(TASKS);
  if (queue?.isAvailable() === true) {
    for (const send of queue.get() as Send[]) {
      const node = nodes.get(send.node);
      if (node === undefined) {
        throw new Error(`Send가 모르는 노드 '${send.node}'를 가리킨다.`);
      }
      tasks.push({ name: send.node, node, arg: { value: send.arg } });
    }
  }
  // 결정적 순서: 이름 안정 정렬(같은 노드의 PUSH들은 Send가 emit된 순서 유지) → fold 순서 고정.
  return tasks.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * **로컬 읽기**: 채널을 복사해 *이 노드의 쓰기만* 반영한 상태를 본다.
 * 라우터가 "방금 내가 쓴 값"으로 분기할 수 있게 하되, 같은 스텝의 다른 노드 쓰기는
 * 여전히 안 보이게 한다(BSP 유지). 복사본은 읽고 버린다 — 원본 채널은 안 더러워진다.
 * langgraph 대응: pregel/_algo.py 의 local_read(fresh=True).
 */
function localRead<S>(
  channels: Channels,
  control: ReadonlySet<string>,
  own: readonly ChannelWriteEntry[],
): S {
  const scratch: Channels = new Map();
  for (const [key, ch] of channels) {
    if (!control.has(key)) {
      scratch.set(key, ch.copy());
    }
  }
  applyWrites(
    scratch,
    own.filter((w) => !control.has(w.channel)),
  );
  return readChannels<S>(scratch, control);
}

/** 채널들의 관찰용 스냅샷(타입/가용성/값). Studio가 이걸로 채널 패널을 그린다. */
function snapshotChannels(channels: Channels, control: ReadonlySet<string>): ChannelSnapshot[] {
  const out: ChannelSnapshot[] = [];
  for (const [key, ch] of channels) {
    if (control.has(key)) {
      continue;
    }
    const available = ch.isAvailable();
    out.push(
      available
        ? { key, type: ch.kind, available, value: ch.get() }
        : { key, type: ch.kind, available },
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행기 (langgraph 대응: pregel/_loop.py)
// ─────────────────────────────────────────────────────────────────────────────

/** compile이 만들어 넘기는 낮춰진 그래프. StateGraph는 이걸 짓기만 하고 실행엔 관여 안 한다. */
export interface PregelSpec<S extends object> {
  /** 이름 → 정점(트리거·bound·writers). */
  nodes: Map<string, PregelNode<S>>;
  /** START의 writers — 진입 엣지/라우터. 입력 주입 직후 한 번 돈다. */
  startWriters: Writer<S>[];
  /** 채널 이름 → 팩토리. 실행마다 새 인스턴스를 만든다(그래프는 재사용 가능해야 하므로). */
  channelFactories: Map<string, () => BaseChannel>;
  /** 상태가 아닌 채널들(트리거·배리어·TASKS). 상태 읽기/스냅샷에서 제외된다. */
  controlChannels: Set<string>;
  /** 그림용 구조. */
  view: GraphView;
}

/**
 * compile 결과. 실행(stream/invoke)만 담당한다.
 *
 * superstep(BSP): 트리거가 깨운 태스크들을 병렬 실행하고, 쓰기는 버퍼했다 스텝 경계에서
 * 한 번에 반영. 같은 채널로 온 여러 쓰기는 리듀서가 fold한다.
 * 다음 활성 태스크는 **갱신된 트리거 채널을 구독한 정점**으로 정해진다(V7).
 */
export class CompiledGraph<S extends object> {
  constructor(private readonly spec: PregelSpec<S>) {}

  /** 그래프 구조를 읽어 반환한다(그림용). Studio가 이걸로 노드/엣지를 그린다. */
  getGraph(): GraphView {
    return this.spec.view;
  }

  /**
   * compile이 만든 채널 이름들(구조 관찰용). 상태 채널 + `branch:to:*` + `join:*` + `__tasks__`.
   * "StateGraph가 무엇으로 낮춰졌는지"를 눈으로 확인하는 창.
   */
  getChannelNames(): string[] {
    return [...this.spec.channelFactories.keys()];
  }

  /** 한 태스크: bound 실행 → writers가 출력을 채널 쓰기로 낮춤. 쓰기는 아직 반영 안 됨(버퍼). */
  private async runTask(
    task: Task<S>,
    snapshot: S,
    channels: Channels,
  ): Promise<ChannelWriteEntry[]> {
    const input = task.arg ? task.arg.value : snapshot;
    const output = await task.node.bound(input as never);
    const writes: ChannelWriteEntry[] = [];
    for (const writer of task.node.writers) {
      // writers는 순서대로 돈다 → 뒤의 라우터는 앞의 상태 쓰기를 로컬 읽기로 본다.
      writes.push(
        ...(await writer(output, () => localRead<S>(channels, this.spec.controlChannels, writes))),
      );
    }
    return writes;
  }

  /**
   * superstep(BSP)으로 실행한다. 매 superstep마다 `{ step, nodes, state, channels }`를 yield하고,
   * 끝나면 최종 상태를 return한다.
   *
   * 한 스텝: Plan(트리거가 깨운 태스크) → Execute(같은 스냅샷/자기 payload로 병렬 실행,
   *        writer가 쓰기를 버퍼) → Update(트리거 consume → applyWrites → 만료 스윕).
   * langgraph 대응: stream() + pregel 루프.
   */
  async *stream(input: S): AsyncGenerator<StepUpdate<S>, S> {
    const { nodes, startWriters, channelFactories, controlChannels } = this.spec;

    const channels: Channels = new Map();
    for (const [key, make] of channelFactories) {
      channels.set(key, make());
    }

    // 입력 주입 = 가상의 START 정점이 도는 스텝. 먼저 상태를 채우고(진입 라우터가 읽어야 하므로),
    // 그 다음 START의 writers가 진입 트리거를 쓴다. 관찰되는 step 0은 첫 사용자 노드다.
    applyWrites(
      channels,
      Object.entries(input).map(([channel, value]) => ({ channel, value })),
    );
    const entryWrites: ChannelWriteEntry[] = [];
    for (const writer of startWriters) {
      entryWrites.push(
        ...(await writer({}, () => localRead<S>(channels, controlChannels, entryWrites))),
      );
    }
    applyWrites(channels, entryWrites);

    const limit = 100;
    let step = 0;

    while (true) {
      // Plan: 트리거 채널에 값이 있는 정점 + TASKS에 쌓인 Send.
      const tasks = prepareNextTasks(channels, nodes);
      if (tasks.length === 0) {
        break;
      }
      if (step >= limit) {
        throw new Error(`재귀 한도(${limit})를 초과했다.`);
      }

      // Execute: PULL은 같은 스냅샷을, PUSH는 자기 payload를 입력으로 병렬 실행. 쓰기는 버퍼.
      const snapshot = readChannels<S>(channels, controlChannels);
      const buffered = await Promise.all(
        tasks.map((task) => this.runTask(task, snapshot, channels)),
      );

      // Update: 먼저 읽은 트리거를 consume(배리어 리셋), 그 다음 쓰기 반영, 마지막에 만료 스윕.
      // consume이 쓰기보다 **먼저**라야 자기 트리거를 다시 쓰는 노드(자기 루프)가 안 죽는다.
      for (const task of tasks) {
        for (const trigger of task.node.triggers) {
          channels.get(trigger)?.consume();
        }
      }
      const updated = applyWrites(channels, buffered.flat());
      expireStale(channels, updated);

      yield {
        step,
        nodes: tasks.map((t) => t.name),
        state: readChannels<S>(channels, controlChannels),
        channels: snapshotChannels(channels, controlChannels),
      };
      step++;
    }

    return readChannels<S>(channels, controlChannels);
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
