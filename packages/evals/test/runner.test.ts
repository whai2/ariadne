import { describe, expect, test } from "bun:test";
import { buildReport, defineDataset, runDataset } from "../src";

const dataset = defineDataset({
  name: "tiny",
  version: "1",
  cases: [
    { id: "a", input: 1, expected: 2, tags: ["ok"] },
    { id: "b", input: 2, expected: 4, tags: ["throws"] },
  ],
});

describe("데이터셋", () => {
  test("중복 id를 데이터셋 경계에서 거절한다", () => {
    expect(() =>
      defineDataset({
        name: "broken",
        version: "1",
        cases: [
          { id: "same", input: 1 },
          { id: "same", input: 2 },
        ],
      }),
    ).toThrow("중복");
  });
});

describe("runDataset", () => {
  test("case × k를 모으고 완료 순서와 무관하게 입력 순서를 지킨다", async () => {
    const active: number[] = [];
    let peak = 0;
    const records = await runDataset({
      dataset,
      trials: 3,
      concurrency: 2,
      target: async (input) => {
        active.push(input);
        peak = Math.max(peak, active.length);
        await Bun.sleep(input === 1 ? 2 : 0);
        active.splice(active.indexOf(input), 1);
        return { steps: [], messages: [{ role: "ai", content: String(input * 2) }], spans: [] };
      },
    });

    expect(records.map((record) => `${record.caseId}:${record.trial}`)).toEqual([
      "a:0",
      "a:1",
      "a:2",
      "b:0",
      "b:1",
      "b:2",
    ]);
    expect(records).toHaveLength(6);
    expect(peak).toBe(2);
  });

  test("대상이 던져도 빈 관측값과 error를 실행 기록에 남긴다", async () => {
    const records = await runDataset({
      dataset,
      target: async (input) => {
        if (input === 2) throw new Error("boom");
        return { steps: [], messages: [], spans: [] };
      },
    });

    expect(records[0]?.error).toBeUndefined();
    expect(records[1]?.error).toEqual({ name: "Error", message: "boom" });
    expect(records[1]?.messages).toEqual([]);
  });

  test("k와 concurrency는 양의 정수다", async () => {
    await expect(
      runDataset({
        dataset,
        trials: 0,
        target: async () => ({ steps: [], messages: [], spans: [] }),
      }),
    ).rejects.toThrow("trials");
  });
});

test("report는 점수를 지어내지 않고 실행 완결성만 집계한다", async () => {
  const records = await runDataset({
    dataset,
    target: async (input) => {
      if (input === 2) throw new Error("boom");
      return { steps: [], messages: [], spans: [] };
    },
  });
  const report = buildReport(dataset, records);
  expect(report).toMatchObject({
    dataset: "tiny",
    version: "1",
    caseCount: 2,
    trialCount: 2,
    completed: 1,
    failed: 1,
  });
  expect(report).not.toHaveProperty("score");
});
