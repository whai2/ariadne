// 엔진이 말하는 타입 — 낮춰진 그래프(PregelSpec)와 실행 관찰(StepUpdate).
// **graph/를 import하지 않는다**: 엔진은 StateGraph도 Command도 모른다.

import type { BaseChannel } from "../channels/base";
import type { PregelNode, Writer } from "./node";

/** 채널 맵. 상태 채널 + 제어 채널(트리거·배리어·TASKS)이 한 그릇에 산다. */
export type Channels = Map<string, BaseChannel>;

/**
 * compile이 만들어 넘기는 **낮춰진 그래프**. graph/와 pregel/의 유일한 접점이다.
 * 이 모양만 맞으면 엔진은 누가 만들었는지 상관하지 않는다(StateGraph는 그중 하나일 뿐).
 */
export interface PregelSpec<S extends object> {
  /** 이름 → 정점(트리거·bound·writers). */
  nodes: Map<string, PregelNode<S>>;
  /** 진입 writers — START의 엣지/라우터. 입력 주입 직후 한 번 돈다. */
  startWriters: Writer<S>[];
  /** 채널 이름 → 팩토리. 실행마다 새 인스턴스를 만든다(그래프는 재사용 가능해야 하므로). */
  channelFactories: Map<string, () => BaseChannel>;
  /** 상태가 아닌 채널들(트리거·배리어·TASKS). 상태 읽기/스냅샷에서 제외된다. */
  controlChannels: Set<string>;
  /** 그림용 구조(엔진은 안 쓰고 그대로 돌려주기만 한다). */
  view: GraphView;
}

/** 그래프의 구조(노드/엣지). Studio가 그림을 그릴 때 읽는다. langgraph 대응: get_graph(). */
export interface GraphView {
  nodes: string[];
  edges: GraphEdge[];
}

/**
 * 그림에 그릴 엣지 하나.
 *
 * `kind`가 필요한 이유: **조건부 엣지는 컴파일 타임에 대상을 모른다.** 라우터가 런타임
 * 함수라서 `addConditionalEdges("model", (s) => ...)`만 봐서는 어디로 갈지 알 수 없다.
 * 그래서 선언할 때 후보를 같이 적어주면(`targets`) 그걸 **점선**으로 그린다.
 * langgraph의 `path_map`이 같은 문제를 같은 방식으로 푼다.
 */
export interface GraphEdge {
  from: string;
  to: string;
  /** `static`(항상 간다) · `conditional`(라우터가 고를 수도 있다). 생략 시 static. */
  kind?: "static" | "conditional";
}

/** 한 채널의 관찰용 스냅샷(Studio가 채널 패널에 그린다). */
export interface ChannelSnapshot {
  key: string;
  /** 채널 종류(예: "LastValue", "BinaryOperatorAggregate"). */
  type: string;
  /** 값이 있으면 true(비어있지 않음). */
  available: boolean;
  /** available일 때만 채워진다. */
  value?: unknown;
}

/** 한 superstep 실행 결과: 그 스텝에 (병렬로) 실행된 노드들 + 직후 상태/채널. langgraph 대응: stream(). */
export interface StepUpdate<S> {
  /** superstep 번호(0부터). */
  step: number;
  /** 이 superstep에 병렬 실행된 노드들. */
  nodes: string[];
  state: S;
  channels: ChannelSnapshot[];
}
