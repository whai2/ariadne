import type { Database } from "bun:sqlite";
import type { ChannelCheckpoint } from "@ariadne/core";

/** 한 스텝의 상태 스냅샷. 제어 채널이나 미완료 태스크는 포함하지 않는다. */
export interface CheckpointSnapshot {
  /** run 안의 0-based 스텝. 새 run에서는 다시 0부터 시작한다. */
  step: number;
  channels: ChannelCheckpoint;
}

/** 저장된 스냅샷. SQL 컬럼과 같은 이름을 쓰되 channels_json만 역직렬화한다. */
export interface Checkpoint extends CheckpointSnapshot {
  thread_id: string;
  checkpoint_ns: string;
  /** 같은 thread/namespace 안에서 증가한다. 시각이 역행해도 최신순은 유지된다. */
  checkpoint_id: number;
  parent_checkpoint_id: number | null;
  created_at: number;
}

interface CheckpointRow extends Omit<Checkpoint, "channels"> {
  channels_json: string;
}

function decode(row: CheckpointRow): Checkpoint {
  const { channels_json, ...metadata } = row;
  return { ...metadata, channels: JSON.parse(channels_json) as ChannelCheckpoint };
}

/** F5.3에서는 namespace를 외부에 열지 않고 항상 빈 문자열을 사용한다. */
export function latestCheckpoint(db: Database, threadId: string): Checkpoint | undefined {
  const row = db
    .query<CheckpointRow, [string]>(
      `SELECT * FROM checkpoints
       WHERE thread_id = ? AND checkpoint_ns = '' ORDER BY checkpoint_id DESC LIMIT 1`,
    )
    .get(threadId);
  return row === null ? undefined : decode(row);
}

export function listCheckpoints(db: Database, threadId: string, limit: number): Checkpoint[] {
  return db
    .query<CheckpointRow, [string, number]>(
      `SELECT * FROM checkpoints
       WHERE thread_id = ? AND checkpoint_ns = '' ORDER BY checkpoint_id DESC LIMIT ?`,
    )
    .all(threadId, limit)
    .map(decode);
}

/**
 * 정상 종료한 run의 스냅샷을 한 번에 공개한다. 마지막 항목은 반드시 정지점이어야 한다.
 * 중간 스텝을 먼저 커밋하면 프로세스 종료 시 그것이 최신 복원 지점으로 오인될 수 있다.
 * 트랜잭션 안에는 동기 DB 작업만 둔다. 모델/툴 실행 중에는 DB 잠금을 잡지 않는다.
 */
export function writeCheckpoints(
  db: Database,
  threadId: string,
  snapshots: readonly CheckpointSnapshot[],
  now: () => number,
): Checkpoint {
  if (threadId.length === 0) throw new Error("threadId는 비어 있을 수 없다.");
  if (snapshots.length === 0) throw new Error("저장할 체크포인트가 없다.");

  return db.transaction(() => {
    let parent = latestCheckpoint(db, threadId)?.checkpoint_id ?? null;
    let last: Checkpoint | undefined;
    for (const snapshot of snapshots) {
      const id = (parent ?? 0) + 1;
      const channelsJson = JSON.stringify(snapshot.channels);
      const createdAt = now();
      db.run(
        `INSERT INTO checkpoints
         (thread_id, checkpoint_id, parent_checkpoint_id, step, channels_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [threadId, id, parent, snapshot.step, channelsJson, createdAt],
      );
      last = {
        thread_id: threadId,
        checkpoint_ns: "",
        checkpoint_id: id,
        parent_checkpoint_id: parent,
        step: snapshot.step,
        channels: JSON.parse(channelsJson) as ChannelCheckpoint,
        created_at: createdAt,
      };
      parent = id;
    }
    // 빈 배열은 진입 전에 거부한다. 이 검사로 반환 타입도 undefined 없이 좁힌다.
    if (last === undefined) throw new Error("저장할 체크포인트가 없다.");
    return last;
  })();
}
