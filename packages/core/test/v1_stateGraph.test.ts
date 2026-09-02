import { describe, expect, it } from "bun:test";
import { END, START, StateGraph } from "../src";

interface S {
  text: string;
  steps: number;
}

describe("V1 · 최소 실행 그래프", () => {
  it("선형 그래프 START→a→b→END 가 상태를 변환한다", async () => {
    const g = new StateGraph<S>();
    g.addNode("a", (s) => ({ text: `${s.text} a`, steps: s.steps + 1 }));
    g.addNode("b", (s) => ({ text: `${s.text} b`, steps: s.steps + 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);

    const out = await g.compile().invoke({ text: "start", steps: 0 });
    expect(out.text).toBe("start a b");
    expect(out.steps).toBe(2);
  });

  it("async 노드도 동작한다", async () => {
    const g = new StateGraph<S>();
    g.addNode("a", async (s) => {
      await Promise.resolve();
      return { text: `${s.text}!` };
    });
    g.addEdge(START, "a");
    g.addEdge("a", END);

    const out = await g.compile().invoke({ text: "hi", steps: 0 });
    expect(out.text).toBe("hi!");
  });

  it("부분 상태만 반환해도 나머지 키는 보존된다", async () => {
    const g = new StateGraph<S>();
    g.addNode("a", () => ({ steps: 42 }));
    g.addEdge(START, "a");
    g.addEdge("a", END);

    const out = await g.compile().invoke({ text: "keep", steps: 0 });
    expect(out).toEqual({ text: "keep", steps: 42 });
  });

  describe("가드", () => {
    it("예약 이름(START/END)은 노드로 못 쓴다", () => {
      const g = new StateGraph<S>();
      expect(() => g.addNode(START, () => ({}))).toThrow();
      expect(() => g.addNode(END, () => ({}))).toThrow();
    });

    it("같은 노드를 두 번 추가하면 에러", () => {
      const g = new StateGraph<S>();
      g.addNode("a", () => ({}));
      expect(() => g.addNode("a", () => ({}))).toThrow();
    });

    it("없는 노드로 향하는 엣지는 에러", () => {
      const g = new StateGraph<S>();
      g.addNode("a", () => ({}));
      expect(() => g.addEdge("a", "nope")).toThrow();
    });

    it("한 노드에 아웃엣지 2개(분기)는 V4부터 허용된다", () => {
      const g = new StateGraph<S>();
      g.addNode("a", () => ({}));
      g.addNode("b", () => ({}));
      g.addEdge("a", "b");
      expect(() => g.addEdge("a", END)).not.toThrow();
    });

    it("진입 엣지 없이 compile 하면 에러", () => {
      const g = new StateGraph<S>();
      g.addNode("a", () => ({}));
      expect(() => g.compile()).toThrow();
    });
  });
});
