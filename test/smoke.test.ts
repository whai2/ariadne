import { describe, expect, it } from "bun:test";

// 하네스가 살아있는지 확인하는 스모크 테스트. C1부터 실제 테스트로 대체/추가된다.
describe("harness smoke", () => {
  it("bun test가 동작한다", () => {
    expect(1 + 1).toBe(2);
  });
});
