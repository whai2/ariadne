// F5.2 · 채널이 자기를 내놓는다 — core의 유일한 영속 확장.
//
// F5.1이 남긴 반례: 대화 이력 아닌 채널은 run 경계에서 **키째 사라진다.** 되돌려 넣기로는
// 못 고친다 — 입력은 `applyWrites`로 들어가 리듀서를 타기 때문이다. 복원은 *쓰기*가 아니라
// *세팅*이고, 그건 채널 자신만 할 수 있다.
//
// 여기서 보는 건 **두 경로가 갈려 있다**는 것이다.
//   복원 = `fromCheckpoint` → 대입 (리듀서 우회)
//   입력 = `applyWrites`    → `update()` (리듀서 통과)
// 섞으면 누적 채널이 복원값 위에 또 접힌다. langgraph가 둘을 엄격히 가르는 이유다.

import { describe, expect, test } from "bun:test";
import {
  BinaryOperatorAggregate,
  type ChannelCheckpoint,
  END,
  EphemeralValue,
  LastValue,
  MISSING,
  NamedBarrierValue,
  START,
  StateGraph,
  Topic,
} from "../src/index";

/** 저장소를 거쳤다고 치고 **실제로 JSON을 건넌다** — 여기서 안 죽는 게 요점이다. */
function wire(cp: ChannelCheckpoint): ChannelCheckpoint {
  return JSON.parse(JSON.stringify(cp)) as ChannelCheckpoint;
}

describe("채널 왕복 — checkpoint() → JSON → fromCheckpoint()", () => {
  test("LastValue", () => {
    const ch = new LastValue<number>();
    ch.update([7]);
    const back = ch.fromCheckpoint(JSON.parse(JSON.stringify(ch.checkpoint())));
    expect(back.get()).toBe(7);
  });

  test("BinaryOperatorAggregate — 값은 저장에서, 연산자는 코드에서", () => {
    const ch = new BinaryOperatorAggregate<number>((a, b) => a + b);
    ch.update([1, 2, 3]); // 1 seed, +2, +3 = 6
    expect(ch.get()).toBe(6);

    // 프로토타입이 연산자를 들고 있다. 체크포인트엔 숫자 하나뿐이다.
    const proto = new BinaryOperatorAggregate<number>((a, b) => a + b);
    const back = proto.fromCheckpoint(JSON.parse(JSON.stringify(ch.checkpoint())));
    expect(back.get()).toBe(6);
    // 복원본이 여전히 접을 줄 안다 — 연산자를 안 잃었다.
    back.update([4]);
    expect(back.get()).toBe(10);
  });

  test("EphemeralValue", () => {
    const ch = new EphemeralValue<string>();
    ch.update(["go"]);
    expect(ch.fromCheckpoint(ch.checkpoint()).get()).toBe("go");
  });

  test("Topic", () => {
    const ch = new Topic<number>();
    ch.update([1, 2]);
    const back = ch.fromCheckpoint(JSON.parse(JSON.stringify(ch.checkpoint())));
    expect(back.get()).toEqual([1, 2]);
  });

  test("NamedBarrierValue — Set은 배열로 펴서 건넌다", () => {
    const ch = new NamedBarrierValue(new Set(["b", "e"]));
    ch.update(["b", "e"]);
    const proto = new NamedBarrierValue(new Set(["b", "e"]));
    const back = proto.fromCheckpoint(JSON.parse(JSON.stringify(ch.checkpoint())));
    expect(back.isAvailable()).toBe(true);
  });

  test("배리어는 **반쯤 찬 상태**도 저장한다", () => {
    const ch = new NamedBarrierValue(new Set(["b", "e"]));
    ch.update(["b"]); // 하나만 도착 — 아직 안 열렸다
    expect(ch.isAvailable()).toBe(false);

    // 안 열렸다고 안 저장하면, 복원 후 b가 **다시 와야** 열린다. 그건 틀린 재개다.
    const proto = new NamedBarrierValue(new Set(["b", "e"]));
    const back = proto.fromCheckpoint(JSON.parse(JSON.stringify(ch.checkpoint())));
    expect(back.isAvailable()).toBe(false);
    back.update(["e"]); // 남은 하나만 오면 열린다
    expect(back.isAvailable()).toBe(true);
  });
});

describe("빈 채널 — MISSING이 키의 부재로 번역된다", () => {
  test("한 번도 안 쓴 채널은 MISSING을 내놓는다", () => {
    expect(new LastValue<number>().checkpoint()).toBe(MISSING);
    expect(new BinaryOperatorAggregate<number>((a, b) => a + b).checkpoint()).toBe(MISSING);
    expect(new EphemeralValue<number>().checkpoint()).toBe(MISSING);
    expect(new Topic<number>().checkpoint()).toBe(MISSING);
    expect(new NamedBarrierValue(new Set(["b"])).checkpoint()).toBe(MISSING);
  });

  test("MISSING을 넣으면 빈 채널이 나온다 — 복원이 값을 지어내지 않는다", () => {
    const back = new LastValue<number>().fromCheckpoint(MISSING);
    expect(back.isAvailable()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

interface Counter {
  budget: number;
  note: string;
}

function counterGraph() {
  const g = new StateGraph<Counter>({
    budget: { reducer: (a, b) => a + b },
    note: {},
  });
  g.addNode("spend", () => ({ budget: -2 }));
  g.addEdge(START, "spend");
  g.addEdge("spend", END);
  return g.compile();
}

describe("복원 — 쓰기가 아니라 세팅이다", () => {
  test("복원은 리듀서를 안 탄다", async () => {
    const graph = counterGraph();
    const first = await graph.invoke({ budget: 10, note: "a" });
    expect(first.budget).toBe(8); // 10 seed, -2

    // 체크포인트를 모으려면 스텝을 봐야 한다(`invoke`는 상태만 준다).
    let cp: ChannelCheckpoint = {};
    for await (const step of graph.stream({ budget: 10, note: "a" })) {
      cp = step.checkpoint;
    }
    expect(cp).toEqual({ budget: 8, note: "a" });

    // 복원만 하고 입력은 안 준다. 8이 그대로 서고, 그 위에서 또 -2.
    // **리듀서를 탔다면 8+8=16에서 시작했을 것이다.**
    const resumed = await graph.invoke({} as Counter, { checkpoint: wire(cp) });
    expect(resumed.budget).toBe(6);
    expect(resumed.note).toBe("a"); // 입력에 없었는데 살아 있다
  });

  test("복원 위에 같은 값을 또 실으면 접힌다 — 입력은 '이번에 새로 온 것'이다", async () => {
    const graph = counterGraph();
    let cp: ChannelCheckpoint = {};
    for await (const step of graph.stream({ budget: 10, note: "a" })) {
      cp = step.checkpoint;
    }

    // 복원값 8 위에 입력 8이 리듀서로 접힌다 → 16, 그리고 -2.
    const doubled = await graph.invoke({ budget: 8, note: "a" } as Counter, {
      checkpoint: wire(cp),
    });
    expect(doubled.budget).toBe(14);

    // 이게 두 경로를 가른 대가이자 계약이다 — **복원했으면 입력엔 새것만 싣는다.**
  });

  test("체크포인트가 없으면 지금까지와 한 글자도 안 달라진다", async () => {
    const graph = counterGraph();
    expect((await graph.invoke({ budget: 10, note: "a" })).budget).toBe(8);
    expect((await graph.invoke({ budget: 10, note: "a" }, {})).budget).toBe(8);
  });
});

describe("제어 채널은 안 담는다", () => {
  test("체크포인트엔 상태 채널만 있다", async () => {
    const graph = counterGraph();
    // 컴파일된 그래프는 제어 채널을 갖고 있다.
    expect(graph.getChannelNames().some((k) => k.startsWith("branch:to:"))).toBe(true);

    for await (const step of graph.stream({ budget: 10, note: "a" })) {
      expect(Object.keys(step.checkpoint).sort()).toEqual(["budget", "note"]);
    }
  });

  test("복원해도 진입은 START부터다 — 제어 채널이 안 실려서", async () => {
    const graph = counterGraph();
    let cp: ChannelCheckpoint = {};
    const firstSteps: string[][] = [];
    for await (const step of graph.stream({ budget: 10, note: "a" })) {
      firstSteps.push(step.nodes);
      cp = step.checkpoint;
    }
    expect(firstSteps).toEqual([["spend"]]);

    // 복원한 run도 똑같이 START → spend. 스텝을 이어받는 게 아니라 **상태만** 이어받는다.
    const resumedSteps: string[][] = [];
    for await (const step of graph.stream({} as Counter, { checkpoint: wire(cp) })) {
      resumedSteps.push(step.nodes);
    }
    expect(resumedSteps).toEqual([["spend"]]);
  });
});

describe("알려진 한계 — JSON serde", () => {
  test("값이 undefined면 빈 채널과 구별이 안 된다", async () => {
    const g = new StateGraph<{ x: undefined }>({});
    g.addNode("n", () => ({}));
    g.addEdge(START, "n");
    g.addEdge("n", END);
    const graph = g.compile();

    let cp: ChannelCheckpoint = {};
    for await (const step of graph.stream({ x: undefined })) {
      cp = step.checkpoint;
    }

    // 채널은 "값이 마침 undefined"라고 말하지만(키는 있다)…
    expect("x" in cp).toBe(true);
    // …JSON을 건너면 키가 증발한다. langgraph가 msgpack을 쓰는 이유가 이것이고,
    // 우리는 JSON에 머물기로 했으므로 **고치지 않고 적어둔다.**
    expect("x" in wire(cp)).toBe(false);
  });
});
