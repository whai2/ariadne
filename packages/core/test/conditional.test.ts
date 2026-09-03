import { describe, expect, it } from "bun:test";
import { END, START, StateGraph, type StateSchema } from "../src";

describe("V5 · 조건부 엣지", () => {
  it("짝/홀 라우팅 — router(state)가 다음 노드를 고른다", async () => {
    interface S {
      n: number;
      label: string;
    }
    function build() {
      const g = new StateGraph<S>();
      g.addNode("dispatch", () => ({})); // 통과 노드
      g.addNode("even", () => ({ label: "even" }));
      g.addNode("odd", () => ({ label: "odd" }));
      g.addEdge(START, "dispatch");
      g.addConditionalEdges("dispatch", (s) => (s.n % 2 === 0 ? "even" : "odd"));
      g.addEdge("even", END);
      g.addEdge("odd", END);
      return g.compile();
    }
    expect((await build().invoke({ n: 4, label: "" })).label).toBe("even");
    expect((await build().invoke({ n: 3, label: "" })).label).toBe("odd");
  });

  it("자기 루프 — router가 자신을 가리키다 조건이 되면 END", async () => {
    // count가 n<3이면 자신으로, 아니면 END. n: 0→1→2→3 (3번 실행).
    const g = new StateGraph<{ n: number }>();
    g.addNode("count", (s) => ({ n: s.n + 1 }));
    g.addEdge(START, "count");
    g.addConditionalEdges("count", (s) => (s.n < 3 ? "count" : END));

    const steps = [];
    for await (const step of g.compile().stream({ n: 0 })) {
      steps.push(step);
    }
    expect(steps.map((s) => s.nodes)).toEqual([["count"], ["count"], ["count"]]);
    expect(steps.at(-1)?.state.n).toBe(3);
  });

  it("배열 반환 — 라우터가 여러 노드로 팬아웃한다", async () => {
    const concat: StateSchema<{ log: string[] }> = { log: { reducer: (a, b) => [...a, ...b] } };
    const g = new StateGraph<{ log: string[] }>(concat);
    g.addNode("a", () => ({ log: ["a"] }));
    g.addNode("b", () => ({ log: ["b"] }));
    g.addNode("c", () => ({ log: ["c"] }));
    g.addEdge(START, "a");
    g.addConditionalEdges("a", () => ["b", "c"]); // 둘 다로 분기
    g.addEdge("b", END);
    g.addEdge("c", END);

    const steps = [];
    for await (const step of g.compile().stream({ log: [] })) {
      steps.push(step);
    }
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b", "c"]]);
    expect(steps.at(-1)?.state.log).toEqual(["a", "b", "c"]);
  });

  it("조건부 진입 — addConditionalEdges(START, ...)로 시작 노드를 고른다", async () => {
    const g = new StateGraph<{ n: number; label: string }>();
    g.addNode("even", () => ({ label: "even" }));
    g.addNode("odd", () => ({ label: "odd" }));
    g.addConditionalEdges(START, (s) => (s.n % 2 === 0 ? "even" : "odd"));
    g.addEdge("even", END);
    g.addEdge("odd", END);
    expect((await g.compile().invoke({ n: 2, label: "" })).label).toBe("even");
  });

  it("정적 엣지와 조건부 엣지는 공존한다(합집합)", async () => {
    const concat: StateSchema<{ log: string[] }> = { log: { reducer: (a, b) => [...a, ...b] } };
    const g = new StateGraph<{ log: string[] }>(concat);
    g.addNode("a", () => ({ log: ["a"] }));
    g.addNode("b", () => ({ log: ["b"] }));
    g.addNode("c", () => ({ log: ["c"] }));
    g.addEdge(START, "a");
    g.addEdge("a", "b"); // 정적
    g.addConditionalEdges("a", () => "c"); // 조건부
    g.addEdge("b", END);
    g.addEdge("c", END);

    const steps = [];
    for await (const step of g.compile().stream({ log: [] })) {
      steps.push(step);
    }
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b", "c"]]); // b·c 둘 다
  });

  it("무한 루프는 재귀 한도로 막힌다", async () => {
    const g = new StateGraph<{ n: number }>();
    g.addNode("spin", (s) => ({ n: s.n + 1 }));
    g.addEdge(START, "spin");
    g.addConditionalEdges("spin", () => "spin"); // 영원히 자신
    await expect(g.compile().invoke({ n: 0 })).rejects.toThrow(/재귀 한도/);
  });

  it("라우터가 모르는 노드를 반환하면 에러", async () => {
    const g = new StateGraph<{ x: number }>();
    g.addNode("a", () => ({ x: 1 }));
    g.addEdge(START, "a");
    g.addConditionalEdges("a", () => "nope");
    await expect(g.compile().invoke({ x: 0 })).rejects.toThrow(/모르는 노드 'nope'/);
  });

  it("compile: 정적·조건부 진입 둘 다 없으면 에러", () => {
    const g = new StateGraph<{ x: number }>();
    g.addNode("a", () => ({ x: 1 }));
    g.addEdge("a", END);
    expect(() => g.compile()).toThrow(/진입 엣지가 없다/);
  });
});
