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
  /** 이번 스텝의 업데이트들을 반영한다. 값이 바뀌면 true. */
  update(values: Update[]): boolean;
  /** 비어있지 않으면(값이 있으면) true. */
  isAvailable(): boolean;
}
