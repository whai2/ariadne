import { describe, expect, it } from "bun:test";
import { examples } from "../src/examples";
import { createStudio } from "../src/studio";

const studio = createStudio(examples);

function run(id: string, input: unknown) {
  return studio.fetch(
    new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ id, input }) }),
  );
}

describe("Studio fetch 핸들러 (예제 갤러리)", () => {
  it("GET / 는 HTML 페이지를 준다", async () => {
    const res = await studio.fetch(new Request("http://x/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Ariadne Studio");
  });

  it("GET /api/examples 는 예제 목록을 준다", async () => {
    const list = (await (
      await studio.fetch(new Request("http://x/api/examples"))
    ).json()) as Array<{
      id: string;
      sampleInput: unknown;
    }>;
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list[0]?.id).toBe("linear");
    expect(list.map((e) => e.id)).toContain("accumulate");
  });

  it("GET /api/graph?id=grow 는 해당 예제 구조를 준다", async () => {
    const g = (await (await studio.fetch(new Request("http://x/api/graph?id=grow"))).json()) as {
      nodes: string[];
    };
    expect(g.nodes).toEqual(["research", "write"]);
  });

  it("POST /api/run 은 선택한 예제를 superstep별로 실행한다", async () => {
    const { steps } = (await (await run("linear", { text: "hi", steps: 0 })).json()) as {
      steps: Array<{ step: number; nodes: string[]; channels: Array<{ key: string }> }>;
    };
    expect(steps.map((s) => s.nodes)).toEqual([["greet"], ["shout"]]);
    expect(steps.at(-1)?.channels.map((c) => c.key)).toEqual(["text", "steps"]);
  });

  it("diamond 예제는 b·c가 한 superstep에 병렬 실행되고 리듀서로 합쳐진다", async () => {
    const { steps } = (await (await run("diamond", { log: [] })).json()) as {
      steps: Array<{ nodes: string[]; state: { log: string[] } }>;
    };
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b", "c"], ["d"]]);
    expect(steps.at(-1)?.state.log).toEqual(["a", "b", "c", "d"]);
  });

  it("grow 예제는 스텝마다 채널 수가 늘어난다", async () => {
    const { steps } = (await (await run("grow", { topic: "AI" })).json()) as {
      steps: Array<{ channels: unknown[] }>;
    };
    // step1(research): topic, notes → 2개, step2(write): +article → 3개
    expect(steps[0]?.channels.length).toBe(2);
    expect(steps[1]?.channels.length).toBe(3);
  });

  it("accumulate 예제는 messages가 누적된다(수동)", async () => {
    const { steps } = (await (
      await run("accumulate", { messages: [{ role: "user", content: "안녕?" }] })
    ).json()) as { steps: Array<{ state: { messages: unknown[] } }> };
    expect(steps.at(-1)?.state.messages.length).toBe(3);
  });

  it("reduce 예제는 리듀서로 자동 누적 + 채널 타입이 BinaryOperatorAggregate", async () => {
    const { steps } = (await (
      await run("reduce", { messages: [{ role: "user", content: "안녕?" }] })
    ).json()) as {
      steps: Array<{
        state: { messages: unknown[] };
        channels: Array<{ key: string; type: string }>;
      }>;
    };
    expect(steps.at(-1)?.state.messages.length).toBe(3);
    expect(steps.at(-1)?.channels.find((c) => c.key === "messages")?.type).toBe(
      "BinaryOperatorAggregate",
    );
  });

  it("counter 예제는 add 리듀서로 delta가 누적된다(0→3)", async () => {
    const { steps } = (await (await run("counter", { n: 0 })).json()) as {
      steps: Array<{ state: { n: number } }>;
    };
    expect(steps.at(-1)?.state.n).toBe(3);
  });

  it("잘못된 JSON은 400, 모르는 경로는 404", async () => {
    const bad = await studio.fetch(
      new Request("http://x/api/run", { method: "POST", body: "nope" }),
    );
    expect(bad.status).toBe(400);
    const nf = await studio.fetch(new Request("http://x/zzz"));
    expect(nf.status).toBe(404);
  });
});
