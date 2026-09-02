import { describe, expect, it } from "bun:test";
import { END, InvalidUpdateError, START, StateGraph, type StateSchema } from "../src";

interface S {
  log: string[];
}

const concatLog: StateSchema<S> = { log: { reducer: (a, b) => [...a, ...b] } };

/** 다이아몬드: START→a→{b,c}→d→END. b,c는 한 superstep에 병렬 실행. */
function diamond(schema: StateSchema<S>) {
  const g = new StateGraph<S>(schema);
  g.addNode("a", () => ({ log: ["a"] }));
  g.addNode("b", () => ({ log: ["b"] }));
  g.addNode("c", () => ({ log: ["c"] }));
  g.addNode("d", () => ({ log: ["d"] }));
  g.addEdge(START, "a");
  g.addEdge("a", "b");
  g.addEdge("a", "c"); // 분기(팬아웃)
  g.addEdge("b", "d");
  g.addEdge("c", "d"); // 팬인
  g.addEdge("d", END);
  return g.compile();
}

describe("V4 · superstep(BSP)", () => {
  it("노드가 아웃엣지를 2개 가질 수 있다(분기)", () => {
    const view = diamond(concatLog).getGraph();
    const fromA = view.edges.filter((e) => e.from === "a").map((e) => e.to);
    expect(fromA.sort()).toEqual(["b", "c"]);
  });

  it("병렬 노드(b,c)가 한 superstep에 실행되고, 리듀서가 두 쓰기를 합친다", async () => {
    const steps = [];
    for await (const s of diamond(concatLog).stream({ log: [] })) {
      steps.push(s);
    }
    // step0: a, step1: b·c(병렬), step2: d
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b", "c"], ["d"]]);
    // 최종 log: a, (b·c 병렬 → 리듀서로 합쳐짐), d
    expect(steps.at(-1)?.state.log).toEqual(["a", "b", "c", "d"]);
  });

  it("병렬 쓰기 + LastValue면 InvalidUpdateError (리듀서가 필요한 이유)", async () => {
    // log에 리듀서 없음 → b,c가 같은 스텝에 log를 쓰면 2개 → 거부.
    const g = diamond({});
    await expect(g.invoke({ log: [] })).rejects.toBeInstanceOf(InvalidUpdateError);
  });

  it("invoke는 최종 상태를 준다", async () => {
    const out = await diamond(concatLog).invoke({ log: [] });
    expect(out.log).toEqual(["a", "b", "c", "d"]);
  });
});
