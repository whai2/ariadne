import { describe, expect, it } from "bun:test";
import { EmptyChannelError, InvalidUpdateError, LastValue } from "../src";

describe("V2 · LastValue 채널", () => {
  it("처음엔 비어있다 → get()이 EmptyChannelError", () => {
    const ch = new LastValue<number>();
    expect(ch.isAvailable()).toBe(false);
    expect(() => ch.get()).toThrow(EmptyChannelError);
  });

  it("update 후 get으로 값을 읽는다", () => {
    const ch = new LastValue<number>();
    expect(ch.update([7])).toBe(true);
    expect(ch.isAvailable()).toBe(true);
    expect(ch.get()).toBe(7);
  });

  it("빈 업데이트는 무시한다(false, 여전히 비어있음)", () => {
    const ch = new LastValue<number>();
    expect(ch.update([])).toBe(false);
    expect(ch.isAvailable()).toBe(false);
  });

  it("나중 값이 이전 값을 덮어쓴다", () => {
    const ch = new LastValue<string>();
    ch.update(["a"]);
    ch.update(["b"]);
    expect(ch.get()).toBe("b");
  });

  it("한 스텝에 두 값이면 InvalidUpdateError (리듀서가 필요한 이유 → V3)", () => {
    const ch = new LastValue<number>();
    expect(() => ch.update([1, 2])).toThrow(InvalidUpdateError);
  });

  it("undefined도 '값'으로 저장된다 (MISSING과 구분)", () => {
    const ch = new LastValue<number | undefined>();
    ch.update([undefined]);
    expect(ch.isAvailable()).toBe(true);
    expect(ch.get()).toBeUndefined();
  });
});
