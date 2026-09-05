import { describe, expect, it } from "bun:test";
import type { StateSchema } from "../src";
import { branchTo, Command, END, joinTo, Send, START, StateGraph, TASKS } from "../src";

const concatLog: StateSchema<{ log: string[] }> = { log: { reducer: (a, b) => [...a, ...b] } };

describe("V7 · Command — 노드가 상태와 행선지를 함께 반환", () => {
  it("update + goto: 조건부 엣지 없이 노드가 직접 다음을 정한다", async () => {
    interface S {
      log: string[];
      n: number;
    }
    const g = new StateGraph<S>({ log: { reducer: (a, b) => [...a, ...b] } });
    g.addNode(
      "tick",
      (s) =>
        new Command<S>({ update: { log: ["tick"], n: s.n + 1 }, goto: s.n >= 2 ? END : "tick" }),
    );
    g.addEdge(START, "tick");

    const steps = [];
    for await (const step of g.compile().stream({ log: [], n: 0 })) {
      steps.push(step);
    }
    // n=0,1일 때 자기로, n=2일 때 END → 3번 실행.
    expect(steps.map((s) => s.nodes)).toEqual([["tick"], ["tick"], ["tick"]]);
    expect(steps.at(-1)?.state).toEqual({ log: ["tick", "tick", "tick"], n: 3 });
  });

  it("goto만 있는 Command — 상태는 안 건드리고 분기만", async () => {
    const g = new StateGraph<{ log: string[] }>(concatLog);
    g.addNode("route", () => new Command<{ log: string[] }>({ goto: ["b", "c"] }));
    g.addNode("b", () => ({ log: ["b"] }));
    g.addNode("c", () => ({ log: ["c"] }));
    g.addEdge(START, "route");

    const steps = [];
    for await (const step of g.compile().stream({ log: [] })) {
      steps.push(step);
    }
    expect(steps.map((s) => s.nodes)).toEqual([["route"], ["b", "c"]]);
    expect(steps.at(-1)?.state.log).toEqual(["b", "c"]);
  });

  it("goto에 Send — 노드가 직접 동적 팬아웃(V6은 라우터만 가능했다)", async () => {
    interface S {
      items: number[];
      results: number[];
    }
    const g = new StateGraph<S>({ results: { reducer: (a, b) => [...a, ...b] } });
    g.addNode("fan", (s) => new Command<S>({ goto: s.items.map((i) => new Send("sq", i)) }));
    g.addNode<number>("sq", (n) => ({ results: [n * n] }));
    g.addEdge(START, "fan");

    const out = await g.compile().invoke({ items: [2, 3, 4], results: [] });
    expect(out.results).toEqual([4, 9, 16]);
  });

  it("Command가 모르는 노드로 가려 하면 에러", async () => {
    const g = new StateGraph<{ x: number }>();
    g.addNode("a", () => new Command<{ x: number }>({ goto: "nope" }));
    g.addEdge(START, "a");
    await expect(g.compile().invoke({ x: 0 })).rejects.toThrow(/모르는 노드 'nope'/);
  });
});

describe("V7 · compile이 낮춘 구조 (우리 코드 ↔ langgraph 대응)", () => {
  it("노드마다 트리거 채널, Send용 TASKS, 다중소스엔 join 배리어가 생긴다", () => {
    const g = new StateGraph<{ log: string[] }>(concatLog);
    g.addNode("b", () => ({}));
    g.addNode("e", () => ({}));
    g.addNode("d", () => ({}));
    g.addEdge(START, "b");
    g.addEdge(START, "e");
    g.addEdge(["b", "e"], "d");

    expect(g.compile().getChannelNames()).toEqual([
      "log", // 상태 채널(스키마)
      branchTo("b"), // 노드별 트리거(EphemeralValue)
      branchTo("e"),
      branchTo("d"),
      TASKS, // Send 대기열(Topic)
      joinTo(["b", "e"], "d"), // 다중소스 배리어(NamedBarrierValue)
    ]);
  });

  it("제어 채널은 상태에도 채널 스냅샷에도 안 샌다", async () => {
    const g = new StateGraph<{ log: string[] }>(concatLog);
    g.addNode("a", () => ({ log: ["a"] }));
    g.addEdge(START, "a");
    g.addEdge("a", END);

    const steps = [];
    for await (const step of g.compile().stream({ log: [] })) {
      steps.push(step);
    }
    expect(steps.at(-1)?.state).toEqual({ log: ["a"] });
    expect(steps.at(-1)?.channels.map((c) => c.key)).toEqual(["log"]);
  });
});

describe("V7 · 라우터의 로컬 읽기", () => {
  it("자기 쓰기는 보이고, 같은 스텝 다른 노드의 쓰기는 안 보인다(BSP)", async () => {
    const seen: string[][] = [];
    const g = new StateGraph<{ log: string[] }>(concatLog);
    g.addNode("a", () => ({ log: ["a"] }));
    g.addNode("b", () => ({ log: ["b"] }));
    g.addNode("c", () => ({ log: ["c"] }));
    g.addNode("d", () => ({ log: ["d"] }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("a", "c"); // b와 c는 같은 superstep에 병렬
    g.addConditionalEdges("b", (s) => {
      seen.push([...s.log]);
      return "d";
    });
    g.addEdge("c", "d");

    const out = await g.compile().invoke({ log: [] });
    // b의 라우터가 본 것: 스텝 시작 상태(["a"]) + b 자신의 쓰기(["b"]). c의 "c"는 없다.
    expect(seen).toEqual([["a", "b"]]);
    expect(out.log).toEqual(["a", "b", "c", "d"]);
  });
});
