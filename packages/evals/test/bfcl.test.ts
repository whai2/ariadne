import { expect, test } from "bun:test";
import { BFCL_V4_MINI } from "../src";

test("BFCL 발췌본은 출처가 고정된 simple 6 + irrelevance 6이다", () => {
  expect(BFCL_V4_MINI.version).toBe("6ea5797");
  expect(BFCL_V4_MINI.cases).toHaveLength(12);
  expect(BFCL_V4_MINI.cases.filter((item) => item.tags?.includes("simple"))).toHaveLength(6);
  expect(BFCL_V4_MINI.cases.filter((item) => item.tags?.includes("irrelevance"))).toHaveLength(6);
  expect(BFCL_V4_MINI.cases.every((item) => item.input.tools.length > 0)).toBe(true);
});

test("irrelevance 사례의 기대 호출은 비어 있다", () => {
  const irrelevant = BFCL_V4_MINI.cases.filter((item) => item.tags?.includes("irrelevance"));
  expect(irrelevant.every((item) => item.expected?.calls.length === 0)).toBe(true);
});
