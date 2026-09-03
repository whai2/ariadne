// 그래프 엔진의 공유 타입 — StateGraph(빌더)와 Pregel(실행기)이 함께 말하는 "언어".
// 값 로직은 없다(순수 타입). langgraph 대응: graph/state.py의 Annotation류 + stream()의 관찰 타입.

/** 상태 키의 병합 정책. reducer가 있으면 누적 채널, 없으면 LastValue. langgraph의 Annotated 대응. */
export interface ChannelSpec<T> {
  reducer?: (current: T, update: T) => T;
}

/** 상태 스키마: 키별 채널 정책. 선언 안 한 키는 LastValue로 동적 생성. */
export type StateSchema<S> = { [K in keyof S]?: ChannelSpec<S[K]> };

/**
 * 노드 함수: 현재 상태를 받아 "갱신할 부분 상태"를 반환한다.
 * 반환값은 채널에 반영된다(리듀서면 누적, 아니면 덮어쓰기). async 허용.
 */
export type NodeFn<S> = (state: S) => Partial<S> | Promise<Partial<S>>;

/** 그래프의 구조(노드/엣지). Studio가 그림을 그릴 때 읽는다. langgraph 대응: get_graph(). */
export interface GraphView {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
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
