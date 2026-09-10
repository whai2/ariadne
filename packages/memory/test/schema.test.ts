// F4.1 · 저장 구조 — 무엇을 담고 무엇을 **안 담는가.**
//
// 검사 대상이 SQL 제약이라는 게 요점이다. 스키마가 막아주는 건 코드가 안 지켜도 되고,
// 반대로 스키마가 안 막는 건 어딘가에서 반드시 새어 나온다.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrate } from "../src/schema";

function fresh(): Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("migrate — 스키마 적용", () => {
  test("두 번 불러도 안전하다 — 멱등이라 아직 버전 개념이 필요 없다", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    // 그리고 첫 적용의 내용이 살아 있다(재생성이 아니라 무시였다).
    db.run("INSERT INTO episodes (agent, started_at, input_count, status) VALUES (?,?,?,?)", [
      "a",
      1,
      0,
      "running",
    ]);
    migrate(db);
    expect(db.query("SELECT COUNT(*) AS n FROM episodes").get()).toEqual({ n: 1 });
    db.close();
  });

  test("테이블은 둘뿐이다 — 내용과 가치를 가른 게 이 스키마의 전부다", () => {
    const db = fresh();
    const names = (
      db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names.sort()).toEqual(["episodes", "value_events"]);
    db.close();
  });
});

describe("제약 — 스키마가 직접 막는 것", () => {
  test("모르는 status는 CHECK가 막는다", () => {
    const db = fresh();
    expect(() =>
      db.run("INSERT INTO episodes (agent, started_at, input_count, status) VALUES (?,?,?,?)", [
        "a",
        1,
        0,
        "멈춤",
      ]),
    ).toThrow();
    db.close();
  });

  test("kind는 allow/deny 둘뿐이다 — '물어봤다'는 사람의 결정이 아니다", () => {
    const db = fresh();
    const insert = (kind: string) =>
      db.run("INSERT INTO value_events (episode_id, agent, kind, target, at) VALUES (?,?,?,?,?)", [
        1,
        "a",
        kind,
        "t",
        1,
      ]);
    expect(() => insert("allow")).not.toThrow();
    expect(() => insert("deny")).not.toThrow();
    // `ask`는 시스템 상태(물어봤다)이지 사람이 고른 값이 아니라, 가치 채널에 안 들어온다.
    expect(() => insert("ask")).toThrow();
    db.close();
  });

  test("에피소드는 status 없이 못 만든다 — 끝을 모르는 행을 허용하지 않는다", () => {
    const db = fresh();
    expect(() =>
      db.run("INSERT INTO episodes (agent, started_at, input_count) VALUES (?,?,?)", ["a", 1, 0]),
    ).toThrow();
    db.close();
  });
});
