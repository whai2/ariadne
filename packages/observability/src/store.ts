import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Span } from "./span";

export interface TraceRecord {
  traceId: string;
  threadId?: string;
  startedAt: number;
  endedAt: number;
  status: "ok" | "error";
  spans: Span[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS traces (
  trace_id   TEXT PRIMARY KEY NOT NULL,
  thread_id  TEXT,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok','error')),
  spans_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS traces_thread_started ON traces(thread_id, started_at DESC);
`;

interface TraceRow {
  trace_id: string;
  thread_id: string | null;
  started_at: number;
  ended_at: number;
  status: "ok" | "error";
  spans_json: string;
}

/** 완료된 run을 한 행으로 원자적으로 보관하는 자체 SQLite 저장소. */
export class TraceStore {
  private constructor(private readonly db: Database) {}

  static open(path = ":memory:"): TraceStore {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.run(SCHEMA);
    return new TraceStore(db);
  }

  put(spans: readonly Span[]): TraceRecord {
    const root = spans.find((span) => span.parentId === undefined);
    if (root === undefined || spans.some((span) => span.traceId !== root.traceId)) {
      throw new Error("한 trace의 완전한 span 목록이 필요하다.");
    }
    if (root.status === "running" || root.endedAt === undefined) {
      throw new Error("실행 중인 trace는 저장할 수 없다.");
    }
    const thread = root.attributes["ariadne.thread.id"];
    const threadId = typeof thread === "string" ? thread : undefined;
    const copy = structuredClone(spans) as Span[];
    this.db.run(
      `INSERT OR REPLACE INTO traces
       (trace_id, thread_id, started_at, ended_at, status, spans_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        root.traceId,
        threadId ?? null,
        root.startedAt,
        root.endedAt,
        root.status,
        JSON.stringify(copy),
      ],
    );
    return {
      traceId: root.traceId,
      ...(threadId === undefined ? {} : { threadId }),
      startedAt: root.startedAt,
      endedAt: root.endedAt,
      status: root.status,
      spans: copy,
    };
  }

  list(threadId: string, limit = 100): TraceRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error("limit은 0 이상의 안전한 정수여야 한다.");
    const rows = this.db
      .query<TraceRow, [string, number]>(
        "SELECT * FROM traces WHERE thread_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?",
      )
      .all(threadId, limit);
    return rows.map((row) => ({
      traceId: row.trace_id,
      ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      spans: JSON.parse(row.spans_json) as Span[],
    }));
  }

  close(): void {
    this.db.close();
  }
}
