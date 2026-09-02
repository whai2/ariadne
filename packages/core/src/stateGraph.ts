import { END, START } from "./constants";

/**
 * 노드 함수: 현재 상태를 받아 "갱신할 부분 상태"를 반환한다.
 * 반환값은 기존 상태에 얕게(shallow) 병합된다. async 허용(우리는 async 한 벌).
 */
export type NodeFn<S> = (state: S) => Partial<S> | Promise<Partial<S>>;

/** 그래프의 구조(노드/엣지). Studio가 그림을 그릴 때 읽는다. langgraph 대응: get_graph(). */
export interface GraphView {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

/** 한 스텝 실행 결과: 방금 실행된 노드와 그 직후의 전체 상태. langgraph 대응: stream(). */
export interface StepUpdate<S> {
  node: string;
  state: S;
}

/**
 * 최소 StateGraph (V1 · walking skeleton).
 *
 * - 상태 = 평범한 객체. 노드가 돌려준 부분 상태를 `{...state, ...update}`로 병합.
 * - 선형 그래프만: 각 노드는 아웃엣지 1개. START에서 시작해 엣지를 따라가다 END에서 멈춘다.
 * - 채널/리듀서/superstep 없음 — 이후 단계에서 이 내부를 점점 langgraph 구조로 바꾼다.
 *
 * langgraph 대응: graph/state.py 의 StateGraph 표면(add_node/add_edge/compile).
 */
export class StateGraph<S extends object> {
  /** 노드 이름 -> 실행 함수 */
  private readonly nodes = new Map<string, NodeFn<S>>();
  /** 아웃엣지: from -> to (V1은 노드당 1개) */
  private readonly edges = new Map<string, string>();

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
    if (this.edges.has(from)) {
      throw new Error(`'${from}'의 아웃엣지가 이미 있다 (V1은 선형만 지원).`);
    }
    this.edges.set(from, to);
    return this;
  }

  /** 검증 후 실행 가능한 스냅샷을 넘긴다. V1의 compile은 거의 no-op. */
  compile(): CompiledGraph<S> {
    if (!this.edges.has(START)) {
      throw new Error("진입 엣지가 없다: addEdge(START, ...)가 필요하다.");
    }
    return new CompiledGraph(new Map(this.nodes), new Map(this.edges));
  }
}

/** compile 결과. 실행(invoke)만 담당한다. */
export class CompiledGraph<S extends object> {
  constructor(
    private readonly nodes: Map<string, NodeFn<S>>,
    private readonly edges: Map<string, string>,
  ) {}

  /** 그래프 구조를 읽어 반환한다(그림용). Studio가 이걸로 노드/엣지를 그린다. */
  getGraph(): GraphView {
    return {
      nodes: [...this.nodes.keys()],
      edges: [...this.edges.entries()].map(([from, to]) => ({ from, to })),
    };
  }

  /**
   * START부터 엣지를 따라 노드를 순차 실행한다.
   * 매 스텝마다 `{ node, state }`를 yield하고, 끝나면 최종 상태를 return한다.
   * (Studio가 실행을 스텝별로 관찰할 수 있게 하는 관문. langgraph 대응: stream())
   */
  async *stream(input: S): AsyncGenerator<StepUpdate<S>, S> {
    let state: S = { ...input };
    let current = this.edges.get(START);

    // 무한 루프 방지(재귀 한도). V4에서 제대로 다룬다.
    const limit = 100;
    let steps = 0;

    while (current !== undefined && current !== END) {
      if (steps++ >= limit) {
        throw new Error(`재귀 한도(${limit})를 초과했다.`);
      }
      const node = this.nodes.get(current);
      if (node === undefined) {
        throw new Error(`노드 '${current}'가 없다.`);
      }
      const update = await node(state);
      state = { ...state, ...update };
      yield { node: current, state };
      current = this.edges.get(current);
      if (current === undefined) {
        throw new Error(`노드에 아웃엣지가 없다.`);
      }
    }
    return state;
  }

  /** stream을 끝까지 소비하고 최종 상태만 반환한다. (invoke = stream의 마지막) */
  async invoke(input: S): Promise<S> {
    const gen = this.stream(input);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    return r.value;
  }
}
