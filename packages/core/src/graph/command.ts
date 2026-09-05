import type { RouteTarget } from "./types";

/**
 * 노드가 **상태 갱신과 다음 행선지를 한 번에** 반환하는 값(V7).
 *
 * V5·V6까지 제어 흐름은 전부 그래프 선언(정적 엣지·조건부 엣지)에 있었고 노드는
 * 상태만 반환했다. `Command`는 그 둘을 노드 반환값 하나로 합친다:
 *
 * ```ts
 * g.addNode("agent", (s) =>
 *   new Command({ update: { log: ["agent"] }, goto: s.done ? END : "tools" }));
 * ```
 *
 * `goto`는 노드명·`END`·`Send`(동적 팬아웃)를 하나 또는 배열로 받는다. 낮추면
 * update는 상태 채널 쓰기가 되고, goto는 `branch:to:<노드>`/`TASKS` 쓰기가 된다 —
 * **조건부 엣지와 정확히 같은 채널 쓰기**라 엔진에는 새 개념이 아니다.
 *
 * langgraph 대응: types.py 의 Command(update/goto). graph 필드(부모 그래프로
 * 보내기)는 서브그래프가 범위 밖이라 만들지 않았다.
 */
export class Command<S> {
  /** 상태에 반영할 부분 갱신. */
  readonly update: Partial<S> | undefined;
  /** 다음에 깨울 대상들. 항상 배열로 정규화한다(없으면 빈 배열). */
  readonly goto: readonly RouteTarget[];

  constructor(opts: { update?: Partial<S>; goto?: RouteTarget | RouteTarget[] } = {}) {
    this.update = opts.update;
    const target = opts.goto;
    this.goto = target === undefined ? [] : Array.isArray(target) ? target : [target];
  }
}
