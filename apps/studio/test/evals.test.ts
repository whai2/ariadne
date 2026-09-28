import { afterAll, describe, expect, test } from "bun:test";
import { ai } from "@ariadne/core";
import { createStudio } from "../src/studio";

const studio = createStudio(undefined, {
  evals: {
    concurrency: 3,
    target: async (input, context) => ({
      messages: [
        ai(
          "",
          undefined,
          context.caseId.startsWith("irrelevance")
            ? undefined
            : [
                {
                  id: `call-${context.caseId}`,
                  name: input.tools[0]?.name ?? "missing",
                  args: {},
                },
              ],
        ),
      ],
      spans: [],
    }),
  },
});

afterAll(() => studio.close());

describe("Studio eval API", () => {
  test("고정된 BFCL suite와 실제 실행 모델을 설명한다", async () => {
    const res = await studio.fetch(new Request("http://x/api/evals/bfcl"));
    expect(res.status).toBe(200);
    const suite = (await res.json()) as {
      name: string;
      version: string;
      model: string;
      cases: Array<{ id: string; expectedTools: string[] }>;
    };
    expect(suite).toMatchObject({
      name: "bfcl-v4-mini",
      version: "6ea5797",
      model: "claude-code/sonnet",
    });
    expect(suite.cases).toHaveLength(12);
    expect(suite.cases.find((item) => item.id === "irrelevance_0")?.expectedTools).toEqual([]);
  });

  test("같은 runner를 Studio에서 실행하고 12개 기록을 반환한다", async () => {
    const res = await studio.fetch(new Request("http://x/api/evals/bfcl/runs", { method: "POST" }));
    expect(res.status).toBe(200);
    const report = (await res.json()) as {
      caseCount: number;
      trialCount: number;
      completed: number;
      failed: number;
      score?: number;
      records: Array<{ caseId: string; messages: unknown[] }>;
    };
    expect(report).toMatchObject({ caseCount: 12, trialCount: 12, completed: 12, failed: 0 });
    expect(report.records).toHaveLength(12);
    expect(report.score).toBeUndefined();
  });
});
