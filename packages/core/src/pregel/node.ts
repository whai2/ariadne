// Pregel 정점 — compile이 만드는 실행 단위의 "부품 상자".
// langgraph 대응: pregel/_read.py(PregelNode) + pregel/_write.py(ChannelWrite).

/** 채널 하나에 값 하나를 쓰는 항목. langgraph 대응: ChannelWriteEntry. */
export interface ChannelWriteEntry {
  channel: string;
  value: unknown;
}

/**
 * 정점의 실제 로직. **엔진은 반환값을 해석하지 않는다** — 그대로 writer에게 넘길 뿐이라
 * 타입이 `unknown`이다. "부분 상태냐 Command냐"를 아는 건 graph/ 쪽 writer뿐.
 *
 * 입력을 `never`로 두는 건 PULL(상태)·PUSH(payload)로 입력이 갈려서다 —
 * 어떤 `NodeFn<S, I>`든 여기 담기고, 꺼내 쓸 때 호출부에서 한 번만 좁힌다.
 */
export type BoundFn = (input: never) => unknown;

/**
 * `bound` 실행 뒤에 도는 **쓰기 담당**. 노드 출력을 채널 쓰기 목록으로 바꾼다.
 *
 * 노드 자신은 채널 이름을 모른다 — "부분 상태를 반환"할 뿐이고, 그걸 어느 채널에
 * 어떻게 흘릴지는 전부 writer가 안다(불변식 1). 정적 엣지·조건부 엣지·Command·join은
 * 전부 "출발 노드에 writer를 하나 더 붙이는 것"으로 낮춰진다.
 *
 * @param output 노드가 반환한 값(엔진에겐 불투명). 해석은 writer의 몫.
 * @param read **로컬 읽기** — 스텝 시작 스냅샷에 *이 노드의 쓰기까지만* 반영한 상태.
 *   같은 스텝의 다른 노드 쓰기는 안 보인다(BSP). 라우터가 방금 쓴 값으로 분기할 수
 *   있는 이유. langgraph 대응: `ChannelRead(fresh=True)` / `local_read`.
 */
export type Writer<S> = (
  output: unknown,
  read: () => S,
) => ChannelWriteEntry[] | Promise<ChannelWriteEntry[]>;

/**
 * 그래프의 정점 하나. 실행되는 건 이게 아니라 이걸로 만든 **태스크**다.
 *
 * V6까지 노드는 그냥 `Map<이름, 함수>`였다. V7에서 정점이 **자기 초인종(triggers)**과
 * **자기 우편함(writers)**을 갖게 되면서, 스케줄러는 "엣지가 뭔지" 몰라도 된다:
 * *갱신된 트리거 채널 → 그걸 구독한 정점을 깨운다*가 전부다.
 *
 * langgraph의 `PregelNode`는 추가로 `channels`(읽을 채널 목록)와 `mapper`를 갖는다.
 * 노드마다 다른 입력 스키마를 허용하기 때문인데, 우리는 그래프 하나에 상태 스키마
 * 하나뿐이라 PULL 태스크는 항상 상태 전체를 읽는다 → 지금은 필요 없어 만들지 않았다.
 */
export interface PregelNode<S> {
  /** 이 채널들 중 하나라도 값이 있으면 다음 스텝에 깨어난다. */
  triggers: string[];
  /** 실제 로직(사용자가 `addNode`로 준 함수). */
  bound: BoundFn;
  /** bound 뒤에 순서대로 도는 쓰기들. 첫 writer가 상태 갱신, 뒤가 제어 흐름. */
  writers: Writer<S>[];
}
