import { expect, test } from "bun:test";
import { BFCL_V4_MINI } from "../src";

test("BFCL 발췌본은 출처가 고정된 simple 6 + irrelevance 6이다", () => {
  expect(BFCL_V4_MINI.version).toBe("6ea5797");
  expect(BFCL_V4_MINI.cases).toHaveLength(12);
  expect(BFCL_V4_MINI.cases.filter((item) => item.id.startsWith("simple_"))).toHaveLength(6);
  expect(BFCL_V4_MINI.cases.filter((item) => item.id.startsWith("irrelevance_"))).toHaveLength(6);
  expect(BFCL_V4_MINI.cases.every((item) => item.input.tools.length > 0)).toBe(true);
});

test("irrelevance 사례의 기대 호출은 비어 있다", () => {
  const irrelevant = BFCL_V4_MINI.cases.filter((item) => item.id.startsWith("irrelevance_"));
  expect(irrelevant.every((item) => item.expected?.calls.length === 0)).toBe(true);
});

test("리팩터링해도 제공 툴과 기대 호출의 짝은 그대로다", () => {
  expect(
    BFCL_V4_MINI.cases.map((item) => [
      item.id,
      item.input.tools[0]?.name,
      item.expected?.calls[0]?.name,
    ]),
  ).toEqual([
    ["simple_javascript_0", "validateUserInput", "validateUserInput"],
    ["simple_javascript_1", "getActiveDataEntries", "getActiveDataEntries"],
    ["simple_javascript_3", "submitAtCoordinate", "submitAtCoordinate"],
    ["simple_javascript_4", "emailFormatValidator", "emailFormatValidator"],
    ["simple_javascript_6", "mapTransitions", "mapTransitions"],
    ["simple_javascript_7", "getNextKeyValues", "getNextKeyValues"],
    ["irrelevance_0", "determine_body_mass_index", undefined],
    ["irrelevance_1", "math.sum", undefined],
    ["irrelevance_2", "distance_calculator.calculate", undefined],
    ["irrelevance_3", "find_critical_points", undefined],
    ["irrelevance_4", "find_roots", undefined],
    ["irrelevance_5", "solve_quadratic_equation", undefined],
  ]);
});
