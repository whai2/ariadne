import { describe, expect, it } from "bun:test";
import { BinaryOperatorAggregate, END, START, StateGraph, type StateSchema } from "../src";

describe("V3 · BinaryOperatorAggregate 채널", () => {
  it("합계 리듀서: 스텝을 넘어 누적된다", () => {
    const ch = new BinaryOperatorAggregate<number>((a, b) => a + b);
    ch.update([1]); // seed
    expect(ch.get()).toBe(1);
    ch.update([2]); // 1 + 2
    expect(ch.get()).toBe(3);
  });

  it("한 스텝에 여러 값이 오면 접는다(fold)", () => {
    const ch = new BinaryOperatorAggregate<number>((a, b) => a + b);
    ch.update([1, 2, 3]); // seed 1, +2, +3
    expect(ch.get()).toBe(6);
  });

  it("리스트 concat 리듀서: 이어붙인다", () => {
    const ch = new BinaryOperatorAggregate<number[]>((a, b) => [...a, ...b]);
    ch.update([[1]]);
    ch.update([[2], [3]]);
    expect(ch.get()).toEqual([1, 2, 3]);
  });
});

describe("V3 · 스키마로 리듀서 채널 파생", () => {
  interface State {
    messages: string[];
    count: number;
  }

  function build(schema: StateSchema<State>) {
    const g = new StateGraph<State>(schema);
    g.addNode("a", () => ({ messages: ["a"], count: 1 }));
    g.addNode("b", () => ({ messages: ["b"], count: 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    return g.compile();
  }

  it("리듀서를 달면 노드가 delta만 반환해도 누적된다", async () => {
    const out = await build({
      messages: { reducer: (x, y) => [...x, ...y] },
      count: { reducer: (x, y) => x + y },
    }).invoke({ messages: [], count: 0 });

    expect(out.messages).toEqual(["a", "b"]); // 자동 append
    expect(out.count).toBe(2); // 0 + 1 + 1
  });

  it("리듀서가 없으면(LastValue) 마지막 값이 이긴다 — 대조군", async () => {
    const out = await build({}).invoke({ messages: [], count: 0 });
    expect(out.messages).toEqual(["b"]); // 덮어씀
    expect(out.count).toBe(1); // 덮어씀
  });

  it("채널 스냅샷의 type이 리듀서 여부로 갈린다", async () => {
    const g = new StateGraph<State>({ messages: { reducer: (x, y) => [...x, ...y] } });
    g.addNode("a", () => ({ messages: ["a"], count: 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);
    const steps = [];
    for await (const s of g.compile().stream({ messages: [], count: 0 })) {
      steps.push(s);
    }
    const chans = steps.at(-1)?.channels ?? [];
    expect(chans.find((c) => c.key === "messages")?.type).toBe("BinaryOperatorAggregate");
    expect(chans.find((c) => c.key === "count")?.type).toBe("LastValue");
  });
});
