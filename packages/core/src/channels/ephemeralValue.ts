import { EmptyChannelError } from "../errors";
import { type BaseChannel, MISSING } from "./base";

/**
 * **직전 스텝에 받은 값만** 보관하는 채널. 다음 스텝 경계에서 스스로 비워진다. (V7)
 *
 * 이 "1스텝 수명"이 곧 스케줄링이다: 엣지가 `branch:to:<노드>` 채널에 쓰면 그 노드는
 * *다음* 스텝에 한 번 깨어나고, 아무도 다시 안 쓰면 채널이 비어 노드도 잠든다.
 * 비움은 `update([])`(= "이번 스텝엔 아무도 안 썼다" 통지)로 일어난다.
 *
 * 한 스텝에 여러 값이 와도 거부하지 않는다(마지막 값 채택) — 팬인에서 b·c가 같은
 * 노드를 동시에 깨우는 게 정상이기 때문. langgraph의 `EphemeralValue(guard=False)`에 해당.
 * (guard=True는 우리가 쓸 일이 없어 만들지 않았다.)
 *
 * langgraph 대응: channels/ephemeral_value.py.
 */
export class EphemeralValue<T> implements BaseChannel<T, T> {
  readonly kind = "EphemeralValue";
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
      // 새 스텝 통지 — 직전 스텝 값은 여기서 만료된다.
      if (this.value === MISSING) {
        return false;
      }
      this.value = MISSING;
      return true;
    }
    this.value = values[values.length - 1] as T;
    return true;
  }

  consume(): boolean {
    return false;
  }

  copy(): EphemeralValue<T> {
    const next = new EphemeralValue<T>();
    next.value = this.value;
    return next;
  }
}
