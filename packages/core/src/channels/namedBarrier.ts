import { EmptyChannelError, InvalidUpdateError } from "../errors";
import { type BaseChannel, MISSING } from "./base";

/**
 * **이름 붙은 배리어**: 정해진 이름들이 *전부* 도착해야 비로소 열리는 채널. (V7)
 *
 * 트리거로 쓰면 진짜 join이 된다 — `addEdge(["b","e"], "d")`는 `join:b+e:d` 배리어를
 * 만들고 b·e가 각각 자기 이름을 쓴다. 둘 다 모이기 전엔 `isAvailable()`이 false라
 * d가 안 깨어난다. **도착 스텝이 서로 달라도** 기다린다(비대칭 팬인 해결).
 *
 * `EphemeralValue`와 대비되는 점: 저쪽은 *시간*으로 만료(1스텝)되고, 이쪽은 *조건*으로
 * 열린다(다 모임). 그래서 만료 스윕이 아니라 `consume()`으로 리셋한다 —
 * d가 실제로 돌았을 때만 배리어를 비워 다음 라운드를 다시 기다린다.
 *
 * 값 자체는 의미가 없다(누가 왔는지만 중요). 그래서 `get()`은 undefined를 준다.
 * langgraph 대응: channels/named_barrier_value.py.
 */
export class NamedBarrierValue implements BaseChannel<undefined, string> {
  readonly kind = "NamedBarrierValue";
  private seen = new Set<string>();

  constructor(private readonly names: ReadonlySet<string>) {}

  get(): undefined {
    if (!this.isAvailable()) {
      throw new EmptyChannelError();
    }
    return undefined;
  }

  isAvailable(): boolean {
    return this.seen.size === this.names.size;
  }

  update(values: string[]): boolean {
    let updated = false;
    for (const name of values) {
      if (!this.names.has(name)) {
        throw new InvalidUpdateError(
          `배리어에 등록되지 않은 이름 '${name}' (기대: ${[...this.names].join(", ")}).`,
        );
      }
      if (!this.seen.has(name)) {
        this.seen.add(name);
        updated = true;
      }
    }
    return updated;
  }

  consume(): boolean {
    if (!this.isAvailable()) {
      return false;
    }
    this.seen = new Set();
    return true;
  }

  copy(): NamedBarrierValue {
    const next = new NamedBarrierValue(this.names);
    next.seen = new Set(this.seen);
    return next;
  }

  /**
   * **비었다 = 아직 아무도 안 왔다**이지 "안 열렸다"가 아니다. 둘 중 하나가 도착한
   * 반쯤 찬 배리어는 `isAvailable()`이 false여도 저장해야 한다 — 안 그러면 복원 후
   * 그 하나가 다시 와야 열린다. 그리고 `Set`은 JSON을 못 건너므로 배열로 편다.
   */
  checkpoint(): unknown {
    return this.seen.size === 0 ? MISSING : [...this.seen];
  }

  /** 기대하는 이름 목록은 스펙에서 온다 — 저장되는 건 "누가 왔나"뿐이다. */
  fromCheckpoint(value: unknown): NamedBarrierValue {
    const next = new NamedBarrierValue(this.names);
    if (value !== MISSING) {
      next.seen = new Set(value as string[]);
    }
    return next;
  }
}
