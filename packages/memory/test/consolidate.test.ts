// F4.2 · 공고화 — 가치 신호가 문장 후보로 굳는다.
//
// 검증 대상은 **무엇을 만들고 무엇을 안 만드는가**다. 문장의 품질은 여기서 못 잰다
// (그건 실제 모델 앞에서만 드러나고, F4.0 실험이 이미 한 번 쟀다).

import { describe, expect, test } from "bun:test";
import { DENY_THRESHOLD, proposeFacts } from "../src/consolidate";
import type { ValueEventKind, ValueEventRow } from "../src/schema";
import { MemoryStore } from "../src/store";

let seq = 0;
function ev(agent: string, kind: ValueEventKind, target: string): ValueEventRow {
  seq += 1;
  return { id: seq, episode_id: seq, agent, kind, target, at: seq };
}

describe("proposeFacts — 무엇이 후보가 되나", () => {
  test("거부가 1회면 아무것도 안 만든다 — 한 번은 사고일 수 있다", () => {
    expect(proposeFacts([ev("a", "deny", "rm")], "a")).toEqual([]);
    expect(DENY_THRESHOLD).toBe(2);
  });

  test("거부가 허용보다 적거나 같으면 안 만든다 — 대개 허용하는 툴은 선호가 아니다", () => {
    const events = [
      ev("a", "deny", "rm"),
      ev("a", "deny", "rm"),
      ev("a", "allow", "rm"),
      ev("a", "allow", "rm"),
    ];
    // 기억이 사람을 돕는 게 아니라 방해하는 걸 막는 조건이다.
    expect(proposeFacts(events, "a")).toEqual([]);
  });

  test("임계를 넘기면 **추상화 수준이 다른 후보 셋**을 만든다", () => {
    const drafts = proposeFacts([ev("a", "deny", "rm"), ev("a", "deny", "rm")], "a");
    expect(drafts.map((d) => d.level)).toEqual(["episodic", "preference", "rule"]);
    // 셋 다 같은 툴을 가리킨다 — 나중에 평가를 귀속시킬 키다.
    expect(drafts.every((d) => d.target === "rm")).toBe(true);
    // 그리고 셋 다 문장이 다르다(같으면 UNIQUE에 걸려 하나만 남는다).
    expect(new Set(drafts.map((d) => d.text)).size).toBe(3);
  });

  test("사건형 후보는 **횟수를 그대로 말한다** — 실험이 효과 0이라고 예측한 그 모양", () => {
    const drafts = proposeFacts([ev("a", "deny", "rm"), ev("a", "deny", "rm")], "a");
    expect(drafts.find((d) => d.level === "episodic")?.text).toContain("2회");
    // 선호형·규칙형엔 횟수가 없다 — 사건을 지우고 일반화한 게 그 둘의 정의다.
    expect(drafts.find((d) => d.level === "preference")?.text).not.toContain("2회");
  });

  test("origin에 근거가 남는다 — 왜 이 사실이 생겼는지 되짚을 수 있어야 한다", () => {
    const events = [
      ev("a", "deny", "rm"),
      ev("a", "deny", "rm"),
      ev("a", "deny", "rm"),
      ev("a", "allow", "rm"),
    ];
    expect(proposeFacts(events, "a")[0]?.origin).toBe("deny 3 / allow 1");
  });

  test("툴마다 따로 센다 — 이름순으로 나온다(관찰이 안 흔들리게)", () => {
    const events = [
      ev("a", "deny", "zap"),
      ev("a", "deny", "zap"),
      ev("a", "deny", "add"),
      ev("a", "deny", "add"),
      ev("a", "deny", "safe"), // 1회뿐 → 안 만들어진다
    ];
    expect([...new Set(proposeFacts(events, "a").map((d) => d.target))]).toEqual(["add", "zap"]);
  });

  test("다른 에이전트의 이벤트는 안 섞인다", () => {
    const events = [ev("a", "deny", "rm"), ev("b", "deny", "rm")];
    expect(proposeFacts(events, "a")).toEqual([]); // a는 1회뿐
  });
});

describe("MemoryStore.consolidate — 저장까지", () => {
  function seeded() {
    const s = MemoryStore.open(":memory:", { now: () => 1 });
    const ep = s.beginEpisode("fs", []);
    s.recordValueEvent(ep, "fs", "deny", ["write_file"]);
    s.recordValueEvent(ep, "fs", "deny", ["write_file"]);
    return s;
  }

  test("가치 이벤트에서 사실이 생긴다", () => {
    const s = seeded();
    expect(s.facts("fs")).toEqual([]);
    expect(s.consolidate("fs")).toBe(3);
    expect(s.facts("fs").map((f) => f.level)).toEqual(["episodic", "preference", "rule"]);
    s.close();
  });

  test("두 번 불러도 안 늘어난다 — 멱등이라 '어디까지 했나' 플래그가 필요 없다", () => {
    const s = seeded();
    expect(s.consolidate("fs")).toBe(3);
    expect(s.consolidate("fs")).toBe(0);
    expect(s.facts("fs").length).toBe(3);
    s.close();
  });

  test("이미 있는 사실은 **행이 안 바뀐다** — 재공고화가 선택 기록을 지우지 않는다", () => {
    const s = seeded();
    s.consolidate("fs");
    const before = s.facts("fs")[0];
    const ep = s.beginEpisode("fs", []);
    s.recordValueEvent(ep, "fs", "deny", ["write_file"]); // 3회째
    s.consolidate("fs");
    // 사건형 문장이 "3회"로 바뀌므로 **새 행**이 생긴다(옛 행은 그대로 산다).
    expect(s.facts("fs").length).toBe(4);
    expect(s.facts("fs")[0]).toEqual(before as never);
    s.close();
  });

  test("에이전트별로 갈린다", () => {
    const s = seeded();
    s.consolidate("fs");
    expect(s.facts("mcp")).toEqual([]);
    s.close();
  });
});
