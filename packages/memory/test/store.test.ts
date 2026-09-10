// F4.1 · MemoryStore — 쌓는 것과 안 쌓는 것.
//
// 시각은 주입한다(`now`). 이 링의 유일한 비결정성이라, 막아두면 나머지가 전부 결정론적이다.

import { describe, expect, test } from "bun:test";
import { ai, human, tool as toolMessage } from "@ariadne/core";
import { MemoryStore } from "../src/store";

/** 시계를 1부터 한 칸씩 올리는 스토어. 시각이 순서를 그대로 드러낸다. */
function store() {
  let t = 0;
  return MemoryStore.open(":memory:", { now: () => ++t });
}

describe("에피소드 — 겪은 일", () => {
  test("beginEpisode는 running으로 행을 **먼저** 만들고 id를 준다", () => {
    // 승인 게이트가 run *도중에* 이 id로 가치 이벤트를 써야 한다 — 끝나고 한 번에 쓰면
    // 그 시점엔 사람의 결정이 이미 지나가 있다.
    const s = store();
    const id = s.beginEpisode("calc", [human("3+4")]);
    expect(id).toBeGreaterThan(0);

    const [ep] = s.episodes("calc");
    expect(ep?.status).toBe("running");
    expect(ep?.ended_at).toBeNull();
    expect(ep?.input_count).toBe(1);
    s.close();
  });

  test("endEpisode는 **이번 run에 새로 생긴 메시지만** 저장한다 — 이력은 클라이언트가 쥔다", () => {
    const s = store();
    const history = [human("a"), ai("b"), human("c")]; // 클라이언트가 다시 보낸 이력
    const id = s.beginEpisode("calc", history);
    s.endEpisode(id, [ai("d")], "completed"); // 새로 생긴 건 하나뿐

    const [ep] = s.episodes("calc");
    expect(ep?.input_count).toBe(3); // 들어온 이력은 길이만 센다
    expect(JSON.parse(ep?.messages ?? "[]")).toEqual([{ role: "ai", content: "d" }]);
    expect(ep?.status).toBe("completed");
    expect(ep?.ended_at).not.toBeNull();
    s.close();
  });

  test("대기가 남은 run은 paused로 닫힌다 — 멈춤도 완결된 한 번의 run이다", () => {
    const s = store();
    const id = s.beginEpisode("fs", [human("파일 만들어줘")]);
    s.endEpisode(id, [ai("", undefined, [{ id: "c1", name: "write_file", args: {} }])], "paused");
    expect(s.episodes("fs")[0]?.status).toBe("paused");
    s.close();
  });

  test("재개는 **새 에피소드**가 된다 — 서버는 두 run을 잇지 않는다", () => {
    // 이을 키가 없고(무상태), 이을 이유도 아직 없다 — 집계는 (agent, target) 카운트라
    // 두 turn이 이어졌든 아니든 결과가 같다. F3.3 노트: "재개는 새 run이다."
    const s = store();
    const first = s.beginEpisode("fs", [human("파일 만들어줘")]);
    s.endEpisode(
      first,
      [ai("", undefined, [{ id: "c1", name: "write_file", args: {} }])],
      "paused",
    );

    const second = s.beginEpisode("fs", [human("파일 만들어줘"), ai("")]);
    s.endEpisode(second, [toolMessage("c1", "ok"), ai("했다")], "completed");

    expect(second).not.toBe(first);
    expect(s.episodes("fs").map((e) => e.status)).toEqual(["completed", "paused"]); // 최신순
    s.close();
  });

  test("모델이 던져도 호출자가 닫으면 running이 안 남는다", () => {
    // 스튜디오가 try/finally로 닫는다. 여기선 그 계약이 가능한지만 본다.
    const s = store();
    const id = s.beginEpisode("calc", []);
    s.endEpisode(id, [], "completed");
    expect(s.episodes()[0]?.ended_at).not.toBeNull();
    s.close();
  });
});

describe("가치 이벤트 — 사람이 내린 결정", () => {
  test("이름마다 행을 하나씩 남긴다 — 집계 단위가 툴 이름이다", () => {
    const s = store();
    const id = s.beginEpisode("fs", []);
    s.recordValueEvent(id, "fs", "deny", ["write_file", "edit_file"]);

    const events = s.valueEvents("fs");
    expect(events.map((e) => e.target).sort()).toEqual(["edit_file", "write_file"]);
    expect(events.every((e) => e.kind === "deny")).toBe(true);
    expect(events.every((e) => e.episode_id === id)).toBe(true);
    s.close();
  });

  test("targets가 비면 아무것도 안 쓴다 — 묶음 승격이 집계를 오염시키지 않는다", () => {
    // 승인 정책이 묶음 단위라 안전한 툴이 위험한 툴에 딸려 거부된다. 무엇을 거를지는
    // 게이트가 아는 정보라 호출자가 걸러서 준다.
    const s = store();
    const id = s.beginEpisode("mcp", []);
    s.recordValueEvent(id, "mcp", "deny", []);
    expect(s.valueEvents("mcp")).toEqual([]);
    s.close();
  });

  test("allow도 남는다 — 가치는 나쁨만이 아니다", () => {
    const s = store();
    const id = s.beginEpisode("fs", []);
    s.recordValueEvent(id, "fs", "allow", ["write_file"]);
    expect(s.valueEvents("fs")[0]?.kind).toBe("allow");
    s.close();
  });
});

describe("격리와 결정성", () => {
  test("다른 에이전트의 기록은 안 섞인다", () => {
    const s = store();
    const a = s.beginEpisode("calc", []);
    const b = s.beginEpisode("fs", []);
    s.recordValueEvent(a, "calc", "allow", ["add"]);
    s.recordValueEvent(b, "fs", "deny", ["write_file"]);

    expect(s.episodes("calc").length).toBe(1);
    expect(s.valueEvents("calc").map((e) => e.target)).toEqual(["add"]);
    expect(s.valueEvents("fs").map((e) => e.target)).toEqual(["write_file"]);
    // 인자 없이 부르면 전부.
    expect(s.episodes().length).toBe(2);
    expect(s.valueEvents().length).toBe(2);
    s.close();
  });

  test("now를 주입하면 시각이 결정론적이다 — 이 링의 유일한 비결정성을 경계로 몰아냈다", () => {
    const s = MemoryStore.open(":memory:", { now: () => 42 });
    const id = s.beginEpisode("calc", []);
    s.recordValueEvent(id, "calc", "allow", ["add"]);
    expect(s.episodes()[0]?.started_at).toBe(42);
    expect(s.valueEvents()[0]?.at).toBe(42);
    s.close();
  });

  test("기본 경로는 :memory: — 테스트가 실수로 파일을 안 만든다", () => {
    const s = MemoryStore.open();
    expect(s.episodes()).toEqual([]);
    s.close();
  });
});
