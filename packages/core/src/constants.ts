// 그래프의 가상 진입/종료 노드 이름.
// dunder(__..__) 규칙으로 사용자 노드 이름과 충돌을 피한다.
// langgraph 대응: constants.py 의 START / END.
export const START = "__start__";
export const END = "__end__";

/**
 * `Send`들이 쌓이는 예약 채널(V7). PUSH 태스크의 대기열이며 `Topic`이 백킹한다.
 * langgraph 대응: constants.py 의 TASKS.
 */
export const TASKS = "__tasks__";

/**
 * 노드 하나를 깨우는 **트리거 채널** 이름(V7). 엣지/라우터/Command가 여기에 쓰면
 * 그 노드가 다음 스텝에 깨어난다. `EphemeralValue`가 백킹해 1스텝만 산다.
 * langgraph 대응: graph/state.py 의 `_CHANNEL_BRANCH_TO`("branch:to:{}").
 */
export function branchTo(node: string): string {
  return `branch:to:${node}`;
}

/**
 * 다중소스 엣지의 **join 배리어** 채널 이름(V7). `NamedBarrierValue`가 백킹해
 * starts가 전부 도착해야 end를 깨운다.
 * langgraph 대응: graph/state.py 의 `join:{'+'.join(starts)}:{end}`.
 */
export function joinTo(starts: readonly string[], end: string): string {
  return `join:${starts.join("+")}:${end}`;
}
