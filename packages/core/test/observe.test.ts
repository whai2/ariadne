import { describe, expect, it } from "bun:test";
import { END, START, StateGraph, type StepUpdate } from "../src";

interface S {
  text: string;
  steps: number;
}

function linear() {
  const g = new StateGraph<S>();
  g.addNode("a", (s) => ({ text: `${s.text} a`, steps: s.steps + 1 }));
  g.addNode("b", (s) => ({ text: `${s.text} b`, steps: s.steps + 1 }));
  g.addEdge(START, "a");
  g.addEdge("a", "b");
  g.addEdge("b", END);
  return g.compile();
}

describe("core 관찰 API (Studio가 요구)", () => {
  it("getGraph()가 노드/엣지 구조를 반환한다", () => {
    const view = linear().getGraph();
    expect(view.nodes).toEqual(["a", "b"]);
    expect(view.edges).toEqual([
      { from: START, to: "a", kind: "static" },
      { from: "a", to: "b", kind: "static" },
      { from: "b", to: END, kind: "static" },
    ]);
  });

  it("조건부 엣지는 **대상을 알려줘야** 그림에 나온다 (langgraph의 path_map)", () => {
    // 라우터는 런타임 함수라 컴파일 타임에 행선지를 모른다.
    const g = new StateGraph<{ n: number }>();
    g.addNode("model", (s) => ({ n: s.n + 1 }));
    g.addNode("tool", (s) => ({ n: s.n }));
    g.addEdge(START, "model");
    g.addEdge("tool", "model"); // 루프의 돌아오는 길은 정적이다
    g.addConditionalEdges("model", (s) => (s.n < 2 ? "tool" : END), ["tool", END]);

    const view = g.compile().getGraph();
    expect(view.edges).toEqual([
      { from: START, to: "model", kind: "static" },
      { from: "tool", to: "model", kind: "static" },
      { from: "model", to: "tool", kind: "conditional" },
      { from: "model", to: END, kind: "conditional" },
    ]);
  });

  it("대상을 안 알려주면 그림에서 **사라진다** — 모르는 걸 지어내지 않는다", () => {
    const g = new StateGraph<{ n: number }>();
    g.addNode("a", (s) => ({ n: s.n + 1 }));
    g.addEdge(START, "a");
    g.addConditionalEdges("a", () => END); // targets 없음
    expect(g.compile().getGraph().edges).toEqual([{ from: START, to: "a", kind: "static" }]);
  });

  it("targets는 **그림용일 뿐** — 실행은 라우터가 정한다", async () => {
    const g = new StateGraph<{ log: string[] }>({ log: { reducer: (a, b) => [...a, ...b] } });
    g.addNode("a", () => ({ log: ["a"] }));
    g.addNode("b", () => ({ log: ["b"] }));
    g.addEdge(START, "a");
    // 목록엔 b만 적었지만 라우터는 END로 간다 — 막지 않는다.
    g.addConditionalEdges("a", () => END, ["b"]);
    const out = await g.compile().invoke({ log: [] });
    expect(out.log).toEqual(["a"]); // b는 안 돌았다
  });

  it("stream()이 superstep별로 {step, nodes, state}를 순서대로 내보낸다", async () => {
    const steps: StepUpdate<S>[] = [];
    for await (const step of linear().stream({ text: "start", steps: 0 })) {
      steps.push(step);
    }
    // 선형이라 스텝당 노드 1개.
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b"]]);
    expect(steps.map((s) => s.step)).toEqual([0, 1]);
    expect(steps[0]?.state).toEqual({ text: "start a", steps: 1 });
    expect(steps[1]?.state).toEqual({ text: "start a b", steps: 2 });
  });

  it("invoke()는 stream의 마지막 상태와 같다", async () => {
    const input: S = { text: "start", steps: 0 };
    const viaInvoke = await linear().invoke(input);

    let last: S | undefined;
    for await (const step of linear().stream(input)) {
      last = step.state;
    }
    expect(viaInvoke).toEqual(last as S);
    expect(viaInvoke).toEqual({ text: "start a b", steps: 2 });
  });
});
