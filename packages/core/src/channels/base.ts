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
}
