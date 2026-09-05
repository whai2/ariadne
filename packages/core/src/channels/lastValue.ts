import { EmptyChannelError, InvalidUpdateError } from "../errors";
import { type BaseChannel, MISSING } from "./base";

/**
 * 마지막으로 받은 값을 저장하는 기본 채널.
 * **한 스텝에 최대 한 번만** 쓸 수 있다(여러 값이 오면 InvalidUpdateError).
 * 상태 키에 리듀서가 없으면 이 채널로 컴파일된다.
 * langgraph 대응: channels/last_value.py 의 LastValue.
 */
export class LastValue<T> implements BaseChannel<T, T> {
  readonly kind = "LastValue";
  private value: T | typeof MISSING = MISSING;

  get(): T {
    if (this.value === MISSING) {
      throw new EmptyChannelError();
    }
    return this.value;
  }

  isAvailable(): boolean {
    return this.value !== MISSING;
  }

  update(values: T[]): boolean {
    if (values.length === 0) {
      return false;
    }
    if (values.length !== 1) {
      throw new InvalidUpdateError(
        "LastValue는 한 스텝에 한 값만 받는다. 여러 값을 합치려면 리듀서 채널이 필요하다 (V3).",
      );
    }
    this.value = values[0] as T;
    return true;
  }

  /** 상태 채널은 읽어도 사라지지 않는다. */
  consume(): boolean {
    return false;
  }

  copy(): LastValue<T> {
    const next = new LastValue<T>();
    next.value = this.value;
    return next;
  }
}
