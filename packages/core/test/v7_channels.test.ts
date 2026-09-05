import { describe, expect, it } from "bun:test";
import {
  EmptyChannelError,
  EphemeralValue,
  InvalidUpdateError,
  NamedBarrierValue,
  Topic,
} from "../src";

describe("V7 · EphemeralValue — 시간으로 만료되는 채널(트리거)", () => {
  it("빈 업데이트(=새 스텝 통지)를 받으면 값이 만료된다", () => {
    const ch = new EphemeralValue<null>();
    expect(ch.update([null])).toBe(true);
    expect(ch.isAvailable()).toBe(true); // 다음 스텝에 노드를 깨운다

    expect(ch.update([])).toBe(true); // 아무도 다시 안 씀 → 만료
    expect(ch.isAvailable()).toBe(false); // 노드는 잠든다
    expect(ch.update([])).toBe(false); // 이미 비었으면 변화 없음
  });

  it("한 스텝에 여러 값이 와도 거부하지 않는다(팬인이 정상이므로)", () => {
    // b,c가 동시에 같은 노드를 깨우는 경우. LastValue였다면 InvalidUpdateError.
    const ch = new EphemeralValue<string>();
    expect(ch.update(["b", "c"])).toBe(true);
    expect(ch.get()).toBe("c"); // 마지막 값 채택 — 어차피 "깨워라" 신호라 값은 안 쓴다
  });

  it("consume은 no-op이다(만료는 스텝 경계가 담당)", () => {
    const ch = new EphemeralValue<null>();
    ch.update([null]);
    expect(ch.consume()).toBe(false);
    expect(ch.isAvailable()).toBe(true);
  });
});

describe("V7 · NamedBarrierValue — 조건으로 열리는 채널(join)", () => {
  it("이름이 전부 모여야 열린다", () => {
    const ch = new NamedBarrierValue(new Set(["b", "e"]));
    expect(ch.isAvailable()).toBe(false);
    expect(() => ch.get()).toThrow(EmptyChannelError);

    expect(ch.update(["b"])).toBe(true);
    expect(ch.isAvailable()).toBe(false); // b만 왔다 — 아직 안 열림

    expect(ch.update(["e"])).toBe(true);
    expect(ch.isAvailable()).toBe(true); // 다 모임 → 이제 깨운다
  });

  it("같은 이름이 두 번 와도 중복으로 안 센다", () => {
    const ch = new NamedBarrierValue(new Set(["b", "e"]));
    ch.update(["b"]);
    expect(ch.update(["b"])).toBe(false);
    expect(ch.isAvailable()).toBe(false);
  });

  it("consume이 리셋한다 — 열린 뒤에만", () => {
    const ch = new NamedBarrierValue(new Set(["b"]));
    expect(ch.consume()).toBe(false); // 안 열렸으면 아무 일 없음
    ch.update(["b"]);
    expect(ch.consume()).toBe(true);
    expect(ch.isAvailable()).toBe(false); // 다음 라운드를 다시 기다린다
  });

  it("빈 업데이트로는 만료되지 않는다(EphemeralValue와 다른 점)", () => {
    const ch = new NamedBarrierValue(new Set(["b", "e"]));
    ch.update(["b"]);
    expect(ch.update([])).toBe(false); // 스텝이 지나도 b가 왔다는 사실은 유지
    ch.update(["e"]);
    expect(ch.isAvailable()).toBe(true); // 스텝이 달라도 join이 성립
  });

  it("등록 안 된 이름이면 InvalidUpdateError", () => {
    const ch = new NamedBarrierValue(new Set(["b"]));
    expect(() => ch.update(["z"])).toThrow(InvalidUpdateError);
  });
});

describe("V7 · Topic — 한 스텝의 값들을 목록으로 (TASKS 백킹)", () => {
  it("온 값들을 순서대로 담고, 다음 스텝 통지에 비워진다", () => {
    const ch = new Topic<number>();
    expect(ch.isAvailable()).toBe(false);

    expect(ch.update([1, 2, 3])).toBe(true);
    expect(ch.get()).toEqual([1, 2, 3]);

    expect(ch.update([])).toBe(true); // 새 스텝 → 큐 만료
    expect(ch.isAvailable()).toBe(false);
  });

  it("스텝마다 교체된다(누적 아님)", () => {
    const ch = new Topic<number>();
    ch.update([1]);
    ch.update([2]);
    expect(ch.get()).toEqual([2]);
  });
});
