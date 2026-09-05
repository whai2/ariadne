import { describe, expect, it } from "bun:test";
import { END, Send, START, StateGraph, type StateSchema } from "../src";

describe("V6 · Send 팬아웃 (map-reduce)", () => {
  it("리스트를 런타임 개수만큼 병렬 처리 → 리듀서로 취합 (조건부 진입)", async () => {
    interface S {
      items: number[];
      results: number[];
    }
    const schema: StateSchema<S> = { results: { reducer: (a, b) => [...a, ...b] } };
    function build() {
      const g = new StateGraph<S>(schema);
      // worker: PUSH 태스크라 payload(숫자 하나)를 입력으로 받는다.
      g.addNode("square", (n) => ({ results: [(n as unknown as number) ** 2] }));
      g.addConditionalEdges(START, (s) => s.items.map((i) => new Send("square", i)));
      g.addEdge("square", END);
      return g.compile();
    }
    const out = await build().invoke({ items: [1, 2, 3], results: [] });
    expect(out.results).toEqual([1, 4, 9]);
  });

  it("개수는 런타임 데이터가 정한다 (같은 그래프, 다른 길이)", async () => {
    interface S {
      items: number[];
      results: number[];
    }
    const schema: StateSchema<S> = { results: { reducer: (a, b) => [...a, ...b] } };
    function build() {
      const g = new StateGraph<S>(schema);
      g.addNode("square", (n) => ({ results: [(n as unknown as number) ** 2] }));
      g.addConditionalEdges(START, (s) => s.items.map((i) => new Send("square", i)));
      g.addEdge("square", END);
      return g.compile();
    }
    expect((await build().invoke({ items: [1, 2, 3, 4, 5], results: [] })).results).toEqual([
      1, 4, 9, 16, 25,
    ]);
    expect((await build().invoke({ items: [7], results: [] })).results).toEqual([49]);
    // 빈 리스트 → Send 0개 → 활성 태스크 없음 → 즉시 종료
    expect((await build().invoke({ items: [], results: [] })).results).toEqual([]);
  });

  it("각 PUSH 태스크는 자기 payload를 입력으로 받는다(공유 상태 아님)", async () => {
    interface S {
      items: string[];
      seen: string[];
    }
    const schema: StateSchema<S> = { seen: { reducer: (a, b) => [...a, ...b] } };
    const g = new StateGraph<S>(schema);
    // item을 그대로 남긴다 → 각 태스크가 서로 다른 자기 항목을 받았음을 증명
    g.addNode("echo", (item) => ({ seen: [item as unknown as string] }));
    g.addConditionalEdges(START, (s) => s.items.map((i) => new Send("echo", i)));
    g.addEdge("echo", END);

    const out = await g.compile().invoke({ items: ["a", "b", "c"], seen: [] });
    expect(out.seen).toEqual(["a", "b", "c"]);
  });

  it("dispatch→worker(×N)→gather: map한 뒤 팬인으로 reduce", async () => {
    interface S {
      nums: number[];
      doubled: number[];
      total: number;
    }
    const schema: StateSchema<S> = { doubled: { reducer: (a, b) => [...a, ...b] } };
    const g = new StateGraph<S>(schema);
    g.addNode("fan", () => ({})); // 통과 노드(여기서 팬아웃)
    g.addNode("double", (n) => ({ doubled: [(n as unknown as number) * 2] }));
    g.addNode("sum", (s) => ({ total: s.doubled.reduce((a, b) => a + b, 0) }));
    g.addEdge(START, "fan");
    g.addConditionalEdges("fan", (s) => s.nums.map((n) => new Send("double", n)));
    g.addEdge("double", "sum"); // N개의 double이 sum으로 팬인
    g.addEdge("sum", END);

    const steps = [];
    for await (const step of g.compile().stream({ nums: [1, 2, 3], doubled: [], total: 0 })) {
      steps.push(step);
    }
    // ss0: fan, ss1: double×3(병렬), ss2: sum(팬인 1개)
    expect(steps.map((s) => s.nodes)).toEqual([["fan"], ["double", "double", "double"], ["sum"]]);
    expect(steps.at(-1)?.state.doubled).toEqual([2, 4, 6]);
    expect(steps.at(-1)?.state.total).toBe(12);
  });

  it("Send가 모르는 노드를 가리키면 에러", async () => {
    const g = new StateGraph<{ items: number[] }>();
    g.addNode("real", () => ({}));
    g.addConditionalEdges(START, () => [new Send("ghost", 1)]);
    await expect(g.compile().invoke({ items: [1] })).rejects.toThrow(/모르는 노드 'ghost'/);
  });
});
