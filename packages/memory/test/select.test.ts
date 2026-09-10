// F4.3 · 선택 기계 — 무엇을 시험하고, 결과를 어떻게 읽나.
//
// **이 단계의 검증은 하나다: 사건형 후보가 스스로 도태되는가.**
// F4.0 실험이 답을 이미 알고 있으니(사건 서술은 효과 0), 기계가 스스로 거기 도달하면
// 기계가 도는 것이고 도달 못 하면 기계가 고장 난 것이다.

import { describe, expect, test } from "bun:test";
import { ai, human, tool as toolMessage } from "@ariadne/core";
import type { FactLevel, ScoredFact } from "../src/schema";
import { chooseFact, judge } from "../src/select";
import { MemoryStore } from "../src/store";

function scored(over: Partial<ScoredFact> = {}): ScoredFact {
  return {
    id: 1,
    agent: "a",
    text: "t",
    target: "rm",
    level: "preference",
    origin: "deny 2 / allow 0",
    created_at: 1,
    trials: 0,
    strength: 0,
    ...over,
  };
}

const callRm = ai("", undefined, [{ id: "c1", name: "rm", args: {} }]);

describe("chooseFact — 한 턴에 하나만", () => {
  test("사실이 없으면 undefined — 주입할 게 없다", () => {
    expect(chooseFact([])).toBeUndefined();
  });

  test("**시행이 가장 적은 것**을 먼저 고른다 — 라운드로빈", () => {
    // 귀속이 되려면 후보들이 공평하게 기회를 받아야 한다. 초반에 운 좋게 이긴 후보가
    // 나머지를 굶기면 그건 선택이 아니라 고착이다.
    const chosen = chooseFact([
      scored({ id: 1, trials: 3, strength: 3 }),
      scored({ id: 2, trials: 0, strength: 0 }),
      scored({ id: 3, trials: 1, strength: 1 }),
    ]);
    expect(chosen?.id).toBe(2);
  });

  test("시행이 같으면 강도가 높은 쪽", () => {
    const chosen = chooseFact([
      scored({ id: 1, trials: 2, strength: -2 }),
      scored({ id: 2, trials: 2, strength: 2 }),
    ]);
    expect(chosen?.id).toBe(2);
  });

  test("둘 다 같으면 id가 작은 쪽 — 결정론적이어야 관찰이 안 흔들린다", () => {
    expect(chooseFact([scored({ id: 7 }), scored({ id: 3 })])?.id).toBe(3);
  });

  test("level은 순위에 **안 쓰인다** — 하드코딩을 걷어낸 게 이 단계다", () => {
    const chosen = chooseFact([
      scored({ id: 1, level: "episodic", trials: 0, strength: 0 }),
      scored({ id: 2, level: "preference", trials: 0, strength: 0 }),
    ]);
    // 선호형이 아니라 **id가 작은 사건형**이 뽑힌다. 무엇이 나은지는 써봐야 안다.
    expect(chosen?.level).toBe("episodic" satisfies FactLevel);
  });
});

describe("judge — 결과를 어떻게 읽나", () => {
  test("대상 툴을 그냥 불렀으면 감쇠 — 사실이 못 막았다", () => {
    expect(judge("rm", [callRm, toolMessage("c1", "ok"), ai("지웠다")], [])).toBe("decay");
  });

  test("대상 툴을 안 불렀으면 강화", () => {
    expect(judge("rm", [ai("지울까요?")], [])).toBe("reinforce");
  });

  test("불렀는데 **승인 대기로 멈췄으면 중립** — 게이트가 잡은 것이지 사실이 잡은 게 아니다", () => {
    // 이걸 강화로 세면 게이트가 잘 막아준 걸 기억의 공으로 착각한다.
    expect(judge("rm", [callRm], [{ id: "c1", name: "rm", args: {} }])).toBe("neutral");
  });

  test("다른 툴을 부른 건 강화다 — 대상 툴을 피한 것이므로", () => {
    const other = ai("", undefined, [{ id: "c1", name: "ls", args: {} }]);
    expect(judge("rm", [other, toolMessage("c1", "a b")], [])).toBe("reinforce");
  });

  test("무관한 턴도 강화로 센다(정직한 잡음) — 라운드로빈이 균등하게 나눠 순위는 안 흔들린다", () => {
    expect(judge("rm", [ai("오늘 날씨는 맑습니다.")], [])).toBe("reinforce");
  });
});

describe("선택 기계가 실제로 도는가", () => {
  /** 거부 2회로 후보 셋을 만든 스토어. */
  function seeded() {
    const s = MemoryStore.open(":memory:", { now: () => 1 });
    const ep = s.beginEpisode("fs", []);
    s.recordValueEvent(ep, "fs", "deny", ["rm"]);
    s.recordValueEvent(ep, "fs", "deny", ["rm"]);
    s.consolidate("fs");
    return s;
  }

  test("처음엔 셋 다 시행 0 — 성적이 없다", () => {
    const s = seeded();
    expect(s.scoredFacts("fs").map((f) => [f.trials, f.strength])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    s.close();
  });

  test("판정이 성적에 반영된다 — neutral은 시행이지만 점수가 0이다", () => {
    const s = seeded();
    const [first] = s.scoredFacts("fs");
    const ep = s.beginEpisode("fs", []);
    s.endInjection(s.beginInjection(first?.id ?? 0, ep), "reinforce");
    s.endInjection(s.beginInjection(first?.id ?? 0, ep), "neutral");
    s.endInjection(s.beginInjection(first?.id ?? 0, ep), "decay");

    const scoredFirst = s.scoredFacts("fs")[0];
    expect(scoredFirst?.trials).toBe(3);
    expect(scoredFirst?.strength).toBe(0); // +1 +0 -1
    s.close();
  });

  test("판정이 undefined면 **시행 기록이 지워진다** — 모르는 턴은 안 센다", () => {
    const s = seeded();
    const [first] = s.scoredFacts("fs");
    const ep = s.beginEpisode("fs", []);
    s.endInjection(s.beginInjection(first?.id ?? 0, ep), undefined);
    expect(s.scoredFacts("fs")[0]?.trials).toBe(0);
    s.close();
  });

  test("한 후보만 계속 실패하면 **저절로 꼴찌가 된다** — 기계의 산수", () => {
    // **이건 세상이 아니라 산수를 검증한다.** "사건형만 못 막는다"는 걸 여기서 *가정*하고,
    // 그 가정 아래 순위가 갈리는지만 본다. 실제로 사건형이 약한지는 이 테스트가 말해주지
    // 못한다 — 그건 진짜 모델 앞에서만 드러나고, 실측은 F4.0(약함)과 스튜디오(안 약함)가
    // **서로 다르게** 나왔다. 노트 30 참조.
    const s = seeded();
    const ep = s.beginEpisode("fs", []);

    for (let turn = 0; turn < 12; turn++) {
      const fact = chooseFact(s.scoredFacts("fs"));
      if (fact === undefined) throw new Error("고를 사실이 없다");
      const inj = s.beginInjection(fact.id, ep);
      // 사건형이면 모델이 그냥 부르고, 아니면 먼저 묻는다(= F4.0 실험 결과의 재현).
      const produced =
        fact.level === "episodic" ? [callRm, toolMessage("c1", "ok")] : [ai("지울까요?")];
      s.endInjection(inj, judge(fact.target, produced, []));
    }

    const ranked = [...s.scoredFacts("fs")].sort((a, b) => b.strength - a.strength);
    // 사건형이 꼴찌이고 **음수**다 — 아무도 알려주지 않았는데 기계가 알아냈다.
    expect(ranked.at(-1)?.level).toBe("episodic");
    expect(ranked.at(-1)?.strength).toBeLessThan(0);
    expect(ranked[0]?.strength).toBeGreaterThan(0);
    // 그리고 시행이 고르게 나뉘었다 — 라운드로빈이 한쪽만 굶기지 않았다.
    expect(s.scoredFacts("fs").map((f) => f.trials)).toEqual([4, 4, 4]);
    s.close();
  });

  test("도태된 사실도 **지워지지는 않는다** — 왜 졌는지가 행으로 남아야 한다", () => {
    const s = seeded();
    const ep = s.beginEpisode("fs", []);
    const [first] = s.scoredFacts("fs");
    for (let i = 0; i < 5; i++) s.endInjection(s.beginInjection(first?.id ?? 0, ep), "decay");
    expect(s.scoredFacts("fs").length).toBe(3);
    expect(s.scoredFacts("fs")[0]?.strength).toBe(-5);
    s.close();
  });
});

describe("이력이 실린 대화에서도 판정이 된다", () => {
  test("이번 run이 만든 메시지만 본다 — 지난 턴의 호출은 안 센다", () => {
    // judge에 넘기는 건 `AgentReply.messages`(새로 생긴 것만)라 계약상 그렇지만,
    // 이력이 섞여 들어와도 같은 답이 나오는지 한 번 못박는다.
    const history = [human("지워"), callRm, toolMessage("c1", "ok")];
    expect(judge("rm", history, [])).toBe("decay"); // 이력에 호출이 있으면 감쇠
    expect(judge("rm", [ai("지울까요?")], [])).toBe("reinforce");
  });
});
