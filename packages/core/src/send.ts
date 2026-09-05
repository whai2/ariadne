/**
 * Send (V6): "이 노드를 이 payload로 실행하라"는 동적 팬아웃 명령.
 *
 * 라우터가 리스트 항목마다 Send를 반환하면, 각 Send가 다음 tick의 **PUSH 태스크**가 된다
 * (개수는 런타임 데이터가 정함 = map-reduce). 일반 노드(PULL)는 공유 상태 스냅샷을 읽지만,
 * Send 태스크는 자기 `arg`를 입력으로 받는다.
 *
 * langgraph 대응: types.py 의 Send.
 */
export class Send {
  constructor(
    readonly node: string,
    readonly arg: unknown,
  ) {}
}
