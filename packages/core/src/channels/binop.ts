import { EmptyChannelError } from "../errors";
import { type BaseChannel, MISSING } from "./base";

/**
 * 리듀서 채널. 들어오는 값들을 이항 연산으로 **접어서(fold) 누적**한다.
 * LastValue와 달리 (1) 스텝을 넘어 값이 쌓이고, (2) 한 스텝에 여러 값이 와도 합쳐진다.
 * 상태 키에 reducer를 선언하면 이 채널로 컴파일된다. langgraph 대응: channels/binop.py.
 *
 * 예) reducer=(a,b)=>[...a,...b] → 리스트 이어붙이기, reducer=(a,b)=>a+b → 합계.
 */
export class BinaryOperatorAggregate<T> implements BaseChannel<T, T> {
  readonly kind = "BinaryOperatorAggregate";
  private value: T | typeof MISSING = MISSING;

  constructor(private readonly operator: (a: T, b: T) => T) {}

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
    // 첫 값은 seed, 나머지는 현재 값에 operator로 접는다.
    let acc: T | typeof MISSING = this.value;
    for (const v of values) {
      acc = acc === MISSING ? v : this.operator(acc, v);
    }
    this.value = acc;
    return true;
  }
}
