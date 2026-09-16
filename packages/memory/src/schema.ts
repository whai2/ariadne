// 메모리 링의 저장 구조. DDL과 행 타입을 정의한다.
// episodes/value_events: 경험과 사람의 결정, facts/injections: 기억과 사용 결과.
// checkpoints: 모델에 직접 주입하지 않는 실행 상태(F5.3).

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
 * 주입 한 번의 결과 (F4.3).
 *
 * - `reinforce` 대상 툴을 **안 불렀다.** 사실이 막았다고 본다.
 * - `decay`     대상 툴을 **그냥 불렀다.** 사실이 못 막았다.
 * - `neutral`   불렀는데 **승인 게이트에 걸려 멈췄다** — 게이트가 잡은 것이지 사실이 잡은 게 아니다.
 *
 * `NULL`은 "아직 판정 전"이다(턴이 끝나야 안다).
 */
export type InjectionOutcome = "reinforce" | "decay" | "neutral";

/** `injections` 행 그대로. **선택 기계의 실험 노트**다. */
export interface InjectionRow {
  id: number;
  fact_id: number;
  episode_id: number;
  at: number;
  outcome: InjectionOutcome | null;
}

/**
 * 사실 + 그 사실의 성적 (F4.3). `injections`에서 집계된다.
 *
 * **점수를 `facts`에 캐시하지 않는 게 판단이다.** 숫자만 남기면 "왜 이 사실이 이겼나"의
 * 근거가 사라진다. 시행 하나하나가 행으로 남아 있어야 되짚을 수 있다.
 */
export interface ScoredFact extends FactRow {
  /** 판정이 끝난 주입 횟수. `neutral`도 시행으로 센다. */
  trials: number;
  /** `reinforce` +1 · `decay` -1 · `neutral` 0의 합. */
  strength: number;
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

CREATE TABLE IF NOT EXISTS injections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_id    INTEGER NOT NULL REFERENCES facts(id),
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  at         INTEGER NOT NULL,
  outcome    TEXT CHECK (outcome IN ('reinforce','decay','neutral'))
);

CREATE INDEX IF NOT EXISTS injections_fact ON injections(fact_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id            TEXT    NOT NULL,
  checkpoint_ns        TEXT    NOT NULL DEFAULT '',
  checkpoint_id        INTEGER NOT NULL CHECK (checkpoint_id > 0),
  parent_checkpoint_id INTEGER,
  step                 INTEGER NOT NULL CHECK (step >= 0),
  channels_json        TEXT    NOT NULL,
  created_at           INTEGER NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
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
