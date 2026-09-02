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
      { from: START, to: "a" },
      { from: "a", to: "b" },
      { from: "b", to: END },
    ]);
  });

  it("stream()이 스텝별로 {node, state}를 순서대로 내보낸다", async () => {
    const steps: StepUpdate<S>[] = [];
    for await (const step of linear().stream({ text: "start", steps: 0 })) {
      steps.push(step);
    }
    expect(steps.map((s) => s.node)).toEqual(["a", "b"]);
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
