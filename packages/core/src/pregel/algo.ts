// 순수 알고리즘 — 채널을 읽고/모으고/반영하고, 다음에 뭘 돌릴지 고른다.
// 전부 인자만 보고 결정하는 작은 함수라 단독으로 테스트 가능하다.
// langgraph 대응: pregel/_algo.py.

import { LastValue } from "../channels/lastValue";
import { TASKS } from "../constants";
import type { Send } from "../send";
import type { ChannelWriteEntry, PregelNode } from "./node";
import type { ChannelSnapshot, Channels } from "./types";

/**
 * 상태 채널들에서 값을 모아 평범한 상태 객체로 만든다(Read 단계).
 * 제어 채널은 상태가 아니므로 뺀다 — 노드도 Studio도 `branch:to:*`를 볼 일이 없다.
 * langgraph 대응: pregel/_read.py 의 ChannelRead.
 */
export function readChannels<S>(channels: Channels, control: ReadonlySet<string>): S {
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
export function applyWrites(channels: Channels, writes: readonly ChannelWriteEntry[]): Set<string> {
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
export function expireStale(channels: Channels, updated: ReadonlySet<string>): void {
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
export interface Task<S> {
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
export function prepareNextTasks<S>(
  channels: Channels,
  nodes: Map<string, PregelNode<S>>,
): Task<S>[] {
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
export function localRead<S>(
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
export function snapshotChannels(
  channels: Channels,
  control: ReadonlySet<string>,
): ChannelSnapshot[] {
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
