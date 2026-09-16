import type { ChannelCheckpoint, CompiledGraph } from "@ariadne/core";
import type { CheckpointSnapshot, MemoryStore } from "@ariadne/memory";

/** 실행 래퍼는 저장·복원 계약만 사용한다. DB를 열고 닫는 책임은 호출자에게 있다. */
export type CheckpointStore = Pick<MemoryStore, "getLatest" | "putCheckpoints">;

/**
 * thread의 최신 상태를 복원하고 정상 종료한 run을 저장한다. 반환값은 invoke와 같은 최종 상태다.
 *
 * input은 **이번 변화만** 전달한다. 승인 재개에는 {}를 줄 수 있다.
 * 영속화할 키는 그래프 스키마에 선언해야 복원 시 채널 팩토리가 존재한다.
 * 같은 thread는 직렬로 실행한다. 툴의 외부 부작용은 DB 트랜잭션으로 되돌릴 수 없다.
 *
 * F5.2는 스텝 이벤트에만 체크포인트를 제공한다. 따라서 최소 한 스텝을 실행하는 그래프를
 * 대상으로 한다(createAgent는 항상 해당한다). 0스텝 그래프는 저장 없이 명시적으로 거부한다.
 */
export async function runWithCheckpoint<S extends object>(
  graph: Pick<CompiledGraph<S>, "stream">,
  threadId: string,
  input: Partial<S>,
  store: CheckpointStore,
): Promise<S> {
  if (threadId.length === 0) throw new Error("threadId는 비어 있을 수 없다.");
  const previous = store.getLatest(threadId);
  const snapshots: CheckpointSnapshot[] = [];
  let final: S | undefined;
  for await (const update of graph.stream(
    input as S,
    previous === undefined ? undefined : { checkpoint: previous.channels },
  )) {
    // 다음 스텝이 같은 객체를 변경해도 과거 스냅샷은 바뀌지 않도록 즉시 JSON으로 분리한다.
    snapshots.push({
      step: update.step,
      channels: JSON.parse(JSON.stringify(update.checkpoint)) as ChannelCheckpoint,
    });
    final = update.state;
  }
  if (final === undefined) {
    throw new Error("체크포인트 저장에는 최소 한 스텝을 실행하는 그래프가 필요하다.");
  }
  // stream을 끝까지 소비해야 마지막 스냅샷이 정지점임을 안다. 실패한 run은 공개하지 않는다.
  store.putCheckpoints(threadId, snapshots);
  return final;
}
