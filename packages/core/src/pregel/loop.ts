// superstep 루프 — Plan → Execute → Update를 활성 태스크가 없을 때까지 돌린다.
// langgraph 대응: pregel/_loop.py + Pregel.stream().

import {
  applyWrites,
  checkpointChannels,
  expireStale,
  localRead,
  prepareNextTasks,
  readChannels,
  snapshotChannels,
  type Task,
} from "./algo";
import type { ChannelWriteEntry } from "./node";
import type { ChannelCheckpoint, Channels, GraphView, PregelSpec, StepUpdate } from "./types";

/** 실행 옵션 (F5.2). */
export interface StreamOptions {
  /**
   * 지난 run이 남긴 실행 상태. 주면 채널을 **리듀서를 우회해** 그 값으로 세워두고
   * 시작한다. 그래서 `input`의 뜻이 바뀐다 — 전체 상태가 아니라 **이번에 새로 온 것**이다.
   * (복원 위에 같은 값을 또 실으면 누적 채널에서 두 번 접힌다.)
   */
  checkpoint?: ChannelCheckpoint;
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
   */
  async *stream(input: S, opts?: StreamOptions): AsyncGenerator<StepUpdate<S>, S> {
    const { nodes, startWriters, channelFactories, controlChannels } = this.spec;

    // 채널은 실행마다 새로 만든다(그래프는 재사용 가능해야 하므로). 체크포인트가 있으면
    // 갓 만든 빈 채널을 **프로토타입 삼아** 복원본으로 갈아끼운다 — 리듀서·배리어 이름 같은
    // 코드에서 오는 것은 프로토타입이 들고 있고, 저장된 값만 얹힌다.
    const saved = opts?.checkpoint;
    const channels: Channels = new Map();
    for (const [key, make] of channelFactories) {
      const fresh = make();
      const restored = saved !== undefined && key in saved;
      channels.set(key, restored ? fresh.fromCheckpoint(saved[key]) : fresh);
    }

    // 입력 주입 = 가상의 START 정점이 도는 스텝. 먼저 상태를 채우고(진입 라우터가 읽어야 하므로),
    // 그 다음 진입 writers가 트리거를 쓴다. 관찰되는 step 0은 첫 사용자 노드다.
    //
    // **복원과 반대 경로다.** 복원은 대입(리듀서 우회), 입력은 `applyWrites`(리듀서 통과).
    // 섞으면 누적 채널이 복원값 위에 또 접힌다 — langgraph가 둘을 엄격히 가르는 이유다.
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
        checkpoint: checkpointChannels(channels, controlChannels),
      };
      step++;
    }

    return readChannels<S>(channels, controlChannels);
  }

  /** stream을 끝까지 소비하고 최종 상태만 반환한다. (invoke = stream의 마지막) */
  async invoke(input: S, opts?: StreamOptions): Promise<S> {
    const gen = this.stream(input, opts);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value;
  }
}
