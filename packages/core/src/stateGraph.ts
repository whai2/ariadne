import { END, START } from "./constants";
import { CompiledGraph } from "./pregel";
import type { NodeFn, Router, StateSchema } from "./types";

/**
 * StateGraph (V5 · 조건부 엣지) — 그래프를 **선언**하는 빌더.
 *
 * 순수 sugar다: `compile()`이 노드/엣지를 실행기(`CompiledGraph`)로 낮춘다.
 * 실제 실행(superstep 루프)은 pregel.ts가 담당한다. langgraph 대응: graph/state.py.
 *
 * - 노드는 아웃엣지를 **여러 개** 가질 수 있다(분기/팬아웃). (V4)
 * - 조건부 엣지: `addConditionalEdges(source, router)` — router(state)가 런타임에
 *   다음 노드를 고른다. 조건 분기/루프가 가능해진다. (V5)
 */
export class StateGraph<S extends object> {
  /** 노드 이름 -> 실행 함수 */
  private readonly nodes = new Map<string, NodeFn<S>>();
  /** 정적 아웃엣지: from -> [targets] (V4부터 여러 개 가능) */
  private readonly edges = new Map<string, string[]>();
  /** 조건부 아웃엣지: from -> [routers]. 실행 시 각 router(state)가 대상을 고른다. (V5) */
  private readonly branches = new Map<string, Router<S>[]>();

  /** @param schema 키별 채널 정책(리듀서 등). 생략 시 모든 키가 LastValue. */
  constructor(private readonly schema: StateSchema<S> = {}) {}

  addNode(name: string, fn: NodeFn<S>): this {
    if (name === START || name === END) {
      throw new Error(`'${name}'는 예약된 이름이라 노드로 쓸 수 없다.`);
    }
    if (this.nodes.has(name)) {
      throw new Error(`노드 '${name}'가 이미 있다.`);
    }
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this {
    if (from === END) {
      throw new Error("END에서 나가는 엣지는 만들 수 없다.");
    }
    if (from !== START && !this.nodes.has(from)) {
      throw new Error(`엣지 출발 노드 '${from}'가 없다.`);
    }
    if (to !== END && !this.nodes.has(to)) {
      throw new Error(`엣지 도착 노드 '${to}'가 없다.`);
    }
    const outs = this.edges.get(from) ?? [];
    if (!outs.includes(to)) {
      outs.push(to);
    }
    this.edges.set(from, outs);
    return this;
  }

  /**
   * 조건부 엣지: `source`가 실행된 뒤 `router(state)`가 다음 노드(들)를 고른다. (V5)
   * router는 노드명 하나·여러 개(팬아웃)·END를 반환할 수 있다. 정적 엣지와 공존 가능.
   * source에 여러 번 걸면 결과가 합쳐진다. langgraph 대응: graph/state.py:982 add_conditional_edges.
   */
  addConditionalEdges(source: string, router: Router<S>): this {
    if (source === END) {
      throw new Error("END에서 나가는 엣지는 만들 수 없다.");
    }
    if (source !== START && !this.nodes.has(source)) {
      throw new Error(`조건부 엣지 출발 노드 '${source}'가 없다.`);
    }
    const routers = this.branches.get(source) ?? [];
    routers.push(router);
    this.branches.set(source, routers);
    return this;
  }

  /** 검증 후 실행 가능한 스냅샷(CompiledGraph)을 넘긴다. */
  compile(): CompiledGraph<S> {
    if (!this.edges.has(START) && !this.branches.has(START)) {
      throw new Error(
        "진입 엣지가 없다: addEdge(START, ...) 또는 addConditionalEdges(START, ...)가 필요하다.",
      );
    }
    return new CompiledGraph(
      new Map(this.nodes),
      new Map(this.edges),
      this.schema,
      new Map(this.branches),
    );
  }
}
