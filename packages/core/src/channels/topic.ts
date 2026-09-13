import { EmptyChannelError } from "../errors";
import { type BaseChannel, MISSING } from "./base";

/**
 * 한 스텝에 온 값들을 **목록으로** 모아두는 채널. 다음 스텝 경계에서 비워진다. (V7)
 *
 * 예약 채널 `TASKS`의 백킹 — 라우터/`Command`가 낸 `Send`들이 여기 쌓였다가
 * 다음 스텝에 PUSH 태스크로 읽힌다. V6은 이 큐를 엔진 지역 변수(`active: Task[]`)로
 * 들고 있었는데, V7에서 **채널로 승격**되면서 "모든 제어 흐름 = 채널 쓰기"가 완성된다.
 *
 * `EphemeralValue`와 수명은 같고(1스텝) 담는 개수만 다르다: 저쪽은 마지막 하나,
 * 이쪽은 온 순서대로 전부. langgraph 대응: channels/topic.py (accumulate=False).
 */
export class Topic<T> implements BaseChannel<T[], T> {
  readonly kind = "Topic";
  private values: T[] = [];

  get(): T[] {
    if (this.values.length === 0) {
      throw new EmptyChannelError();
    }
    return this.values;
  }

  isAvailable(): boolean {
    return this.values.length > 0;
  }

  update(values: T[]): boolean {
    const had = this.values.length > 0;
    // 새 스텝 통지(빈 배열) → 직전 스텝 큐는 만료. 값이 있으면 그 스텝 것으로 교체.
    this.values = [...values];
    return had || values.length > 0;
  }

  consume(): boolean {
    return false;
  }

  copy(): Topic<T> {
    const next = new Topic<T>();
    next.values = [...this.values];
    return next;
  }

  checkpoint(): unknown {
    return this.values.length === 0 ? MISSING : [...this.values];
  }

  fromCheckpoint(value: unknown): Topic<T> {
    const next = new Topic<T>();
    if (value !== MISSING) {
      next.values = [...(value as T[])];
    }
    return next;
  }
}
