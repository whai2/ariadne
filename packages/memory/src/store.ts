// 열려 있는 메모리 DB 하나 (F4.1).
//
// **이 저장소의 두 번째 클래스**다(`McpClient` 다음). 이유도 같다 — 감출 가변 상태(DB 핸들)와
// **닫아야 하는 수명**이 진짜로 있다. F3.2에서 확인한 규칙 그대로다: 담을 상태가 실제로 생기면
// 클래스, 아니면 함수. `createAgent`는 여전히 함수로 남는다.
//
// **런타임 의존성 0.** `bun:sqlite`는 Bun 내장이고 `@ariadne/core`는 `import type`으로만 쓴다
// (`verbatimModuleSyntax`가 컴파일에서 지운다). core 다음으로 deps가 0인 두 번째 패키지다.
//
// 파라미터는 **전부 위치(`?`)로** 쓴다. bun:sqlite의 명명 파라미터는 `$` 접두사가 필요한데,
// 그걸 빼먹으면 던지지 않고 **조용히 NULL로 바인딩된다.** 조용한 오작동을 만드는 문법은 안 쓴다.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BaseMessage } from "@ariadne/core";
import { proposeFacts } from "./consolidate";
import {
  type EpisodeRow,
  type FactRow,
  migrate,
  type ValueEventKind,
  type ValueEventRow,
} from "./schema";

export interface MemoryStoreOptions {
  /**
   * 시계 주입. **이 링의 유일한 비결정성이 시각**이라, 테스트가 시간에 안 흔들리게 여기서 막는다.
   * (core의 `applyWrites`를 순수하게 유지한 것과 같은 이유 — 흔들리는 건 경계로 몰아낸다.)
   */
  now?: () => number;
}

/** 조회 기본 개수. 관찰용이라 넉넉할 이유가 없다. */
const DEFAULT_LIMIT = 100;

export class MemoryStore {
  private constructor(
    private readonly db: Database,
    private readonly now: () => number,
  ) {}

  /**
   * 연다. **기본값이 `":memory:"`인 게 안전장치다** — 테스트가 실수로 파일을 안 만든다.
   * 파일 경로를 주면 부모 디렉터리까지 만든다(없으면 sqlite가 던진다).
   */
  static open(path = ":memory:", opts: MemoryStoreOptions = {}): MemoryStore {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    migrate(db);
    return new MemoryStore(db, opts.now ?? Date.now);
  }

  /**
   * run 시작. **행을 `running`으로 먼저 만들고 id를 돌려준다** — 승인 게이트가 run *도중에*
   * 이 id로 가치 이벤트를 써야 하기 때문이다. 끝나고 한 번에 쓰면 그 시점엔 결정이 이미 지나갔다.
   *
   * `history`는 **길이만** 센다. 내용은 클라이언트가 쥐고 있고(무상태 규약), 여기 또 복사하면
   * 매 턴 이력 전체가 중복 저장된다.
   */
  beginEpisode(agent: string, history: readonly BaseMessage[]): number {
    const r = this.db.run(
      "INSERT INTO episodes (agent, started_at, input_count, status) VALUES (?, ?, ?, 'running')",
      [agent, this.now(), history.length],
    );
    // 타입은 `number | bigint`인데(큰 rowid 대비) 실측은 number다. 좁히는 건 여기 한 번뿐이라
    // 경계에서 접는다 — 밖으로 bigint를 흘리면 JSON 직렬화가 던진다.
    return Number(r.lastInsertRowid);
  }

  /**
   * run 종료. `produced`는 **이번 run에 새로 생긴 메시지만**(= `AgentReply.messages`).
   *
   * `paused`도 정상 종료다 — 멈춤은 실패가 아니라 F3.3이 정한 run의 한 가지 끝이고,
   * 재개는 **새 에피소드**가 된다(서버가 무상태라 둘을 잇는 키가 없고, 이을 이유도 아직 없다).
   */
  endEpisode(id: number, produced: readonly BaseMessage[], status: "completed" | "paused"): void {
    this.db.run("UPDATE episodes SET ended_at = ?, messages = ?, status = ? WHERE id = ?", [
      this.now(),
      JSON.stringify(produced),
      status,
      id,
    ]);
  }

  /**
   * 사람이 내린 결정 하나. **이름마다 행을 하나씩** 남긴다 — 집계 단위가 툴 이름이라서.
   *
   * `targets`가 비면 아무것도 안 쓴다. 승인 정책이 **묶음 단위**(F3.3)라 안전한 툴이 위험한 툴에
   * 딸려 거부되는데, 그걸 다 기록하면 집계가 오염된다. 무엇을 거르는지는 **호출자**가 안다
   * (게이트가 어느 이름 때문에 섰는지는 정책이 쥔 정보다).
   */
  recordValueEvent(
    episodeId: number,
    agent: string,
    kind: ValueEventKind,
    targets: readonly string[],
  ): void {
    const at = this.now();
    for (const target of targets) {
      this.db.run(
        "INSERT INTO value_events (episode_id, agent, kind, target, at) VALUES (?, ?, ?, ?, ?)",
        [episodeId, agent, kind, target, at],
      );
    }
  }

  /** 관찰용. 최신순. `agent`를 주면 그 에이전트만. */
  episodes(agent?: string, limit = DEFAULT_LIMIT): EpisodeRow[] {
    return agent === undefined
      ? (this.db
          .query("SELECT * FROM episodes ORDER BY id DESC LIMIT ?")
          .all(limit) as EpisodeRow[])
      : (this.db
          .query("SELECT * FROM episodes WHERE agent = ? ORDER BY id DESC LIMIT ?")
          .all(agent, limit) as EpisodeRow[]);
  }

  /** 관찰용. 최신순. */
  valueEvents(agent?: string, limit = DEFAULT_LIMIT): ValueEventRow[] {
    return agent === undefined
      ? (this.db
          .query("SELECT * FROM value_events ORDER BY id DESC LIMIT ?")
          .all(limit) as ValueEventRow[])
      : (this.db
          .query("SELECT * FROM value_events WHERE agent = ? ORDER BY id DESC LIMIT ?")
          .all(agent, limit) as ValueEventRow[]);
  }

  /**
   * 쌓인 가치 신호를 사실 후보로 굳힌다 (F4.2). 새로 생긴 개수를 돌려준다.
   *
   * **멱등이다.** `UNIQUE(agent, text)` + `INSERT OR IGNORE`라 몇 번 불러도 안전하고,
   * 그래서 "어디까지 공고화했나"를 표시하는 플래그가 필요 없다 — 매번 전체를 다시 집계한다.
   * 값이 싸서 그래도 되고(로컬 SQLite 카운트), **상태를 하나 덜 만드는 쪽**이 낫다.
   *
   * 부수 효과 하나가 여기 딸려 있다: 이미 도태된 사실이 재공고화돼도 **기존 행을 안 건드리므로
   * 부활하지 않는다.** 선택 기록(F4.3)이 그대로 살아 있다.
   */
  consolidate(agent: string): number {
    const drafts = proposeFacts(this.valueEvents(agent, Number.MAX_SAFE_INTEGER), agent);
    const at = this.now();
    let added = 0;
    for (const d of drafts) {
      const r = this.db.run(
        "INSERT OR IGNORE INTO facts (agent, text, target, level, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [d.agent, d.text, d.target, d.level, d.origin, at],
      );
      added += r.changes;
    }
    return added;
  }

  /** 이 에이전트가 아는 사실들. 만든 순서대로(= 후보 셋이 나란히 보인다). */
  facts(agent: string): FactRow[] {
    return this.db.query("SELECT * FROM facts WHERE agent = ? ORDER BY id").all(agent) as FactRow[];
  }

  close(): void {
    this.db.close();
  }
}
