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

  it("staggered 예제는 비대칭 팬인이라 d가 두 번 실행된다(현재 한계 → V7)", async () => {
    const { steps } = (await (await run("staggered", { log: [] })).json()) as {
      steps: Array<{ nodes: string[]; state: { log: string[] } }>;
    };
    // Step 2에 d·e가 같이, Step 3에 d가 또 → d 중복 실행
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b", "c"], ["d", "e"], ["d"]]);
    expect(steps.at(-1)?.state.log).toEqual(["a", "b", "c", "d", "e", "d"]);
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

  it("react 예제는 model⇄tool 루프 후 종료하며 메시지가 누적된다", async () => {
    const { steps } = (await (
      await run("react", { messages: [{ role: "human", content: "2+2 계산해줘" }] })
    ).json()) as {
      steps: Array<{ nodes: string[]; state: { messages: Array<{ content: string }> } }>;
    };
    expect(steps.map((s) => s.nodes)).toEqual([["model"], ["tool"], ["model"]]);
    expect(steps.at(-1)?.state.messages.map((m) => m.content)).toEqual([
      "2+2 계산해줘",
      "도구호출: calc",
      "도구결과: 4",
      "답: 4",
    ]);
  });

  it("rag 예제는 retrieve→summarize×N(동적)→generate로 돈다", async () => {
    const { steps } = (await (
      await run("rag", { query: "AI란?", docs: [], summaries: [], answer: "" })
    ).json()) as {
      steps: Array<{ nodes: string[]; state: { answer: string } }>;
    };
    expect(steps.map((s) => s.nodes)).toEqual([
      ["retrieve"],
      ["summarize", "summarize", "summarize"],
      ["generate"],
    ]);
    expect(steps.at(-1)?.state.answer).toContain("답변:");
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

describe("live 예제 — 진짜 모델을 부르는 그래프", () => {
  function runWith(id: string, input: unknown, model?: string) {
    return studio.fetch(
      new Request("http://x/api/run", {
        method: "POST",
        body: JSON.stringify({ id, input, model }),
      }),
    );
  }

  it("목록이 live 플래그를 알려준다 — UI가 배지·경고를 띄우는 근거", async () => {
    const list = (await (
      await studio.fetch(new Request("http://x/api/examples"))
    ).json()) as Array<{
      id: string;
      live: boolean;
    }>;
    const live = list.filter((e) => e.live).map((e) => e.id);
    expect(live).toEqual(["live-chat", "live-loop"]);
    // 나머지는 전부 모델 없이 도는 순수 예제여야 한다(키 없이도 스튜디오가 쓸모 있게).
    expect(list.filter((e) => !e.live).length).toBeGreaterThanOrEqual(12);
  });

  it("**그래프는 지연 생성된다** — 모르는 모델을 줘도 스튜디오가 죽지 않는다", async () => {
    // import 시점에 만들었다면 자격증명 없는 환경에서 서버가 아예 안 떴을 것이다.
    const res = await runWith("live-chat", { messages: [] }, "그런프로바이더없음/m");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("UnknownProviderError");
  });

  it("키가 필요한 모델을 고르면 **어느 환경변수인지** 말해준다", async () => {
    const res = await runWith("live-chat", { messages: [] }, "groq/llama-3.3-70b");
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("GROQ_API_KEY");
  });

  it("live 예제도 구조는 평범하다 — getGraph가 똑같이 나온다", async () => {
    const g = (await (
      await studio.fetch(new Request("http://x/api/graph?id=live-chat"))
    ).json()) as { nodes: string[]; edges: Array<{ from: string; to: string }> };
    expect(g.nodes).toContain("model");
    expect(g.edges.length).toBeGreaterThan(0);
  });
});

// 실제 모델 호출. `claude` CLI가 있을 때만 돈다(API 키는 필요 없다).
const hasCli = Bun.spawnSync(["which", "claude"]).exitCode === 0;
describe.skipIf(!hasCli)("Studio → 진짜 모델 (구독 자격증명)", () => {
  it("live-chat이 스튜디오를 통해 진짜 답을 받는다", async () => {
    const res = await runLive("live-chat", {
      messages: [{ role: "human", content: "'pong'이라고만 답해라." }],
    });
    expect(res.status).toBe(200);
    const { steps } = (await res.json()) as {
      steps: Array<{
        nodes: string[];
        state: { messages: Array<{ role: string; content: string }> };
      }>;
    };
    expect(steps).toHaveLength(1);
    expect(steps[0]?.nodes).toEqual(["model"]);
    const msgs = steps[0]?.state.messages ?? [];
    expect(msgs.at(-1)?.role).toBe("ai");
    expect((msgs.at(-1)?.content ?? "").length).toBeGreaterThan(0);
  }, 120_000);
});

function runLive(id: string, input: unknown) {
  return studio.fetch(
    new Request("http://x/api/run", { method: "POST", body: JSON.stringify({ id, input }) }),
  );
}
