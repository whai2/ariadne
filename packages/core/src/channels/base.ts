/**
 * "아직 한 번도 안 써짐"을 나타내는 센티넬.
 * 어떤 실제 값(undefined/null 포함)과도 같을 수 없는 고유 심볼이라,
 * "비어있음"과 "값이 마침 undefined"를 구분할 수 있다.
 * langgraph 대응: _internal/_typing.py 의 MISSING.
 */
export const MISSING: unique symbol = Symbol("MISSING");

/**
 * 모든 채널의 공통 인터페이스.
 * 채널 = 상태 한 조각을 담는 그릇. 노드는 채널을 직접 만지지 않고, 엔진이 읽고/쓴다.
 * langgraph 대응: channels/base.py 의 BaseChannel.
 */
export interface BaseChannel<Value = unknown, Update = Value> {
  /** 채널 종류의 표시 이름(Studio 등 관찰용). 예: "LastValue". */
  readonly kind: string;
  /** 현재 값. 비어있으면 EmptyChannelError를 던진다. */
  get(): Value;
  /**
   * 이번 스텝의 업데이트들을 반영한다. 값이 바뀌면 true.
   * **빈 배열은 "이번 스텝엔 아무도 안 썼다"는 통지**다(V7). 수명이 1스텝인 채널
   * (EphemeralValue·Topic)은 여기서 스스로 비워지고, 영속 채널은 no-op이다.
   */
  update(values: Update[]): boolean;
  /** 비어있지 않으면(값이 있으면) true. 트리거로 쓰일 땐 "이 노드를 깨워라"는 뜻. (V7) */
  isAvailable(): boolean;
  /**
   * 이 채널을 트리거로 읽은 태스크가 돌았음을 알린다(V7). 값이 바뀌면 true.
   * 배리어처럼 "읽으면 리셋"인 채널이 여기서 자기를 비운다. 기본은 no-op.
   * langgraph 대응: BaseChannel.consume.
   */
  consume(): boolean;
  /**
   * 값까지 복사한 새 인스턴스(V7). 라우터의 **로컬 읽기**에 쓴다 —
   * 채널을 복사해 자기 쓰기만 반영해보고 버리기 때문에 원본이 안 더러워진다.
   * langgraph 대응: BaseChannel.copy.
   */
  copy(): BaseChannel<Value, Update>;
  /**
   * 직렬화 가능한 스냅샷을 내놓는다(F5.2). 비어 있으면 `MISSING`을 돌려주고,
   * 그러면 체크포인트에 **키가 아예 안 생긴다** — 그게 "빈 채널"과 "값이 마침
   * undefined"를 가르는 유일한 방법이다.
   *
   * `copy()`와 하는 일이 비슷해 보이지만 목적지가 다르다: `copy()`는 메모리 안에서
   * 끝나므로 `Set`이든 클로저든 그대로 들고 가면 되고, 이쪽은 **JSON을 건너야 해서**
   * 그런 것들을 평범한 값으로 펴야 한다(`NamedBarrierValue`가 그 예다).
   *
   * langgraph 대응: channels/base.py 의 BaseChannel.checkpoint.
   */
  checkpoint(): unknown;
  /**
   * 스냅샷에서 **새 인스턴스**를 만든다(F5.2). `this`는 팩토리가 갓 만든 빈 채널이고,
   * 리듀서·배리어 이름 같은 **코드에서 오는 것**만 물려준다.
   *
   * **리듀서를 타지 않는다.** 복원은 *쓰기*가 아니라 *세팅*이다 — `update()`로 하면
   * 누적 채널이 복원값 위에 다시 접혀 값이 어긋난다. 저장된 값은 리듀서가 이미
   * 다 적용된 결과이므로 그대로 대입하는 게 맞다.
   *
   * langgraph 대응: BaseChannel.from_checkpoint (거기서도 `empty.value = checkpoint`다).
   */
  fromCheckpoint(value: unknown): BaseChannel<Value, Update>;
}
