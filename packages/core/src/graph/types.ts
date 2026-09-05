// 사용자가 그래프를 **선언할 때** 쓰는 타입들. 값 로직은 없다(순수 타입).
// langgraph 대응: graph/state.py의 Annotation류 + types.py(RouteTarget).
//
// 실행 관찰 타입(StepUpdate·ChannelSnapshot·GraphView)은 엔진이 내보내는 것이라
// pregel/types.ts에 산다.

import type { Send } from "../send";
import type { Command } from "./command";

/** 상태 키의 병합 정책. reducer가 있으면 누적 채널, 없으면 LastValue. langgraph의 Annotated 대응. */
export interface ChannelSpec<T> {
  reducer?: (current: T, update: T) => T;
}

/** 상태 스키마: 키별 채널 정책. 선언 안 한 키는 LastValue로 동적 생성. */
export type StateSchema<S> = { [K in keyof S]?: ChannelSpec<S[K]> };

/**
 * 노드가 반환할 수 있는 값(V7): 부분 상태, 또는 상태 갱신+행선지를 함께 담은 `Command`.
 * 둘 다 writer가 채널 쓰기로 낮춘다 — 엔진은 이 구분을 모른다.
 */
export type NodeReturn<S> = Partial<S> | Command<S>;

/**
 * 노드 함수: 입력을 받아 "갱신할 부분 상태"(또는 `Command`)를 반환한다.
 * 반환값은 채널에 반영된다(리듀서면 누적, 아니면 덮어쓰기). async 허용.
 *
 * `I`는 이 노드가 받는 입력 타입이다. 기본은 상태 전체(`S`) — 엣지가 깨운 PULL 노드.
 * `Send`로만 도는 워커는 payload를 받으므로 `addNode<number>(...)`처럼 지정한다(V7).
 */
export type NodeFn<S, I = S> = (input: I) => NodeReturn<S> | Promise<NodeReturn<S>>;

/**
 * 라우팅 대상: 노드명(문자열, END 포함) 또는 Send(V6 동적 팬아웃).
 * 문자열이면 그 노드를 PULL 태스크로(공유 상태 읽음), Send면 payload를 실은 PUSH 태스크로.
 */
export type RouteTarget = string | Send;

/**
 * 조건부 엣지의 라우터(V5, V6): 현재 상태를 보고 **다음 대상(들)**을 고른다.
 * 대상 하나, 여러 개(배열 → 팬아웃), 또는 END를 반환할 수 있다. async 허용.
 * V6부터 대상이 Send일 수 있어, 리스트를 런타임 개수만큼 동적 팬아웃한다(map-reduce).
 * 보는 상태는 **source 자신의 쓰기까지만 반영된 로컬 뷰**다(V7).
 * langgraph 대응: graph/_branch.py 의 path 콜러블.
 */
export type Router<S> = (
  state: S,
) => RouteTarget | RouteTarget[] | Promise<RouteTarget | RouteTarget[]>;
