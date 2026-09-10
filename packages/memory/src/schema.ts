// 메모리 링의 저장 구조 — 테이블 둘과 그 행 타입 (F4.1). **순수하다**(DDL 문자열 + 적용 함수).
//
// 담는 게 딱 둘이다:
//   episodes      에이전트가 **겪은 일** — 한 run이 무엇을 받아 무엇을 냈나
//   value_events  사람이 **내린 결정** — 승인했나 거부했나
//
// **둘을 나눈 게 이 스키마의 전부다.** 내용(무슨 일이 있었나)과 가치(좋았나 나빴나)를 같은
// 자리에서 만들면, "무엇이 중요한가"를 쓰는 시점에 판단하게 된다. 그런데 무엇이 쓸모 있는지는
// 그때 알 수 없다 — **중요성은 저장의 속성이 아니라 사용의 결과다.** 그래서 가치는 별도 채널로
// 흐르고, 여기엔 해석이 하나도 안 들어간다(거부됐다는 사실만 적지, 왜 거부했는지는 안 적는다).
//
// 참조: langgraph의 `libs/checkpoint/langgraph/store/base` — 원본도 **체크포인터(실행 상태)와
// 스토어(장기 기억)를 다른 것으로** 갈라놨다. 우리가 여기서 만드는 건 뒤쪽이다. 앞쪽(체크포인터)은
// 모델이 읽지 않는 엔진용 저장이라 성격이 아예 다르고, 메모리 링의 맨 마지막에 온다.

import type { Database } from "bun:sqlite";

/**
 * run의 최후.
 * - `running`   아직 안 끝났다. **프로세스가 죽으면 이 상태로 남는데, 그게 정직하다.**
 * - `completed` 답까지 냈다.
 * - `paused`    승인 대기로 멈췄다(F3.3). 이것도 **완결된 한 번의 run**이다.
 */
export type EpisodeStatus = "running" | "completed" | "paused";

/**
 * 사람이 내린 결정. **`"ask"`가 없다** — 그건 사람의 가치 판단이 아니라 "물어봤다"는 시스템
 * 상태이고, 이미 `AgentReply.pending`으로 관찰된다. 가치 채널엔 사람이 실제로 고른 것만 들어간다.
 */
export type ValueEventKind = "allow" | "deny";

/** `episodes` 행 그대로. **snake_case인 건 SQL과 1:1로 읽히게** 하려는 것이다. */
export interface EpisodeRow {
  id: number;
  agent: string;
  started_at: number;
  /** NULL이면 아직 안 닫혔다. */
  ended_at: number | null;
  /** 들어온 이력의 길이. 무상태 재전송 규약(클라이언트가 이력을 쥔다)의 관찰값이다. */
  input_count: number;
  /** **이번 run에 새로 생긴 메시지만** JSON. 이력 전체가 아니다. */
  messages: string;
  status: EpisodeStatus;
}

/** `value_events` 행 그대로. */
export interface ValueEventRow {
  id: number;
  episode_id: number;
  agent: string;
  kind: ValueEventKind;
  /** 게이트를 촉발한 툴 이름. 집계 단위가 이것이다. */
  target: string;
  at: number;
}

/**
 * 사실의 **추상화 수준** (F4.2).
 *
 * **형식(서술/명령)이 아니라 이 축이 행동을 가른다** — F4.0 실험이 실측으로 보여줬다.
 * 사건을 그대로 옮긴 문장은 모델이 무시하고(6/6 즉시 호출 = 기준선과 동일),
 * 거기서 선호나 규칙을 뽑아낸 문장만 행동을 바꾼다(0/6).
 *
 * 그래서 `kind`(의미/절차) 같은 **형식 컬럼은 없다.** 근거가 없기 때문이다.
 * 이 컬럼은 **순위에 안 쓰인다** — 무엇이 살아남을지는 사용이 정한다(F4.3).
 * 여기 있는 건 "사건형이 도태되는 것"을 **관찰하기 위해서**다.
 */
export type FactLevel = "episodic" | "preference" | "rule";

/** `facts` 행 그대로. */
export interface FactRow {
  id: number;
  agent: string;
  /** system에 그대로 실릴 한 문장. */
  text: string;
  /** 어느 툴에 대한 사실인가. 평가의 귀속 키가 된다(F4.3). */
  target: string;
  level: FactLevel;
  /** 왜 이 사실이 생겼나. 예: `"deny 2 / allow 0"`. 되짚을 수 있어야 한다. */
  origin: string;
  created_at: number;
}

/**
 * DDL. **`IF NOT EXISTS`뿐이라 몇 번 적용해도 안전하다** — 그래서 아직 버전 개념(`user_version`,
 * `ALTER TABLE`)이 없다. 다음 단계에서 테이블이 늘어도 같은 방식으로 붙는다.
 *
 * `PRAGMA`는 하나도 안 건다(WAL·foreign_keys). 지금 답하는 질문이 없다.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS episodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent       TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  input_count INTEGER NOT NULL,
  messages    TEXT    NOT NULL DEFAULT '[]',
  status      TEXT    NOT NULL CHECK (status IN ('running','completed','paused'))
);

CREATE INDEX IF NOT EXISTS episodes_agent_started ON episodes(agent, started_at);

CREATE TABLE IF NOT EXISTS value_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  agent      TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('allow','deny')),
  target     TEXT    NOT NULL,
  at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS value_events_agent_target ON value_events(agent, target);

CREATE TABLE IF NOT EXISTS facts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent      TEXT NOT NULL,
  text       TEXT NOT NULL,
  target     TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('episodic','preference','rule')),
  origin     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(agent, text)
);

CREATE INDEX IF NOT EXISTS facts_agent ON facts(agent);
`;

/**
 * 스키마를 적용한다. 멱등.
 *
 * `agent`가 `value_events`에도 있는 건 **의도적 비정규화**다. 다음 단계의 집계가
 * `(agent, target)`이라 조인 없이 한 줄로 끝난다 — 그리고 그 집계가 이 테이블의 존재 이유다.
 */
export function migrate(db: Database): void {
  db.run(SCHEMA_SQL);
}
