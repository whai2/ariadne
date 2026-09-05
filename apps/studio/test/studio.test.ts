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

describe("Chat 플레이그라운드", () => {
  function chat(body: unknown) {
    return studio.fetch(
      new Request("http://x/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("GET /api/providers — 드롭다운에 쓸 목록. **뭐가 필요한지까지** 알려준다", async () => {
    const list = (await (
      await studio.fetch(new Request("http://x/api/providers"))
    ).json()) as Array<{ id: string; ready: boolean; need: string; suggested?: string }>;

    expect(list.length).toBeGreaterThan(150); // 어댑터가 맡는 것 전부
    // 미지원(Bedrock 등)은 고를 수 없어야 한다 — 고르면 실패할 게 뻔하다.
    expect(list.map((p) => p.id)).not.toContain("amazon-bedrock");

    const groq = list.find((p) => p.id === "groq");
    expect(groq?.need).toContain("GROQ_API_KEY"); // 키가 없으면 이름을 말해준다
    expect(groq?.suggested).toBeTruthy(); // 모델 칸 placeholder

    // 준비된 것이 앞에 온다(드롭다운 첫 그룹).
    const firstNotReady = list.findIndex((p) => !p.ready);
    const lastReady = list.map((p) => p.ready).lastIndexOf(true);
    if (firstNotReady !== -1 && lastReady !== -1) expect(lastReady).toBeLessThan(firstNotReady);
  });

  it("spec이나 messages가 없으면 400", async () => {
    expect((await chat({ messages: [{ role: "human", content: "x" }] })).status).toBe(400);
    expect((await chat({ spec: "claude-code/sonnet" })).status).toBe(400);
    expect((await chat({ spec: "claude-code/sonnet", messages: [] })).status).toBe(400);
  });

  it("모델 생성 실패는 **고칠 수 있는 메시지**로 돌아온다", async () => {
    const body = (await (
      await chat({ spec: "groq/llama-3.3-70b", messages: [{ role: "human", content: "hi" }] })
    ).json()) as { error: string };
    expect(body.error).toContain("GROQ_API_KEY");
  });
});

describe.skipIf(!hasCli)("Chat → 진짜 모델 (구독 자격증명)", () => {
  it("대화가 이어진다 — 이력을 보내면 모델이 앞 턴을 안다", async () => {
    const ask = (messages: unknown) =>
      studio.fetch(
        new Request("http://x/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spec: "claude-code/sonnet", messages, system: "아주 짧게." }),
        }),
      );

    const turn1 = (await (
      await ask([{ role: "human", content: "내가 좋아하는 숫자는 7이야. 알겠다고만 답해." }])
    ).json()) as { messages: Array<{ role: string; content: string }>; steps: unknown[] };

    expect(turn1.messages).toHaveLength(1);
    expect(turn1.messages[0]?.role).toBe("ai");
    expect(turn1.steps).toHaveLength(1); // 챗도 그래프로 돈다 — 스텝이 관찰된다

    const history = [
      { role: "human", content: "내가 좋아하는 숫자는 7이야. 알겠다고만 답해." },
      ...turn1.messages,
      { role: "human", content: "내가 좋아하는 숫자는? 숫자만." },
    ];
    const turn2 = (await (await ask(history)).json()) as {
      messages: Array<{ content: string }>;
    };
    expect(turn2.messages[0]?.content).toContain("7");
  }, 180_000);
});

describe("클라이언트 JS 회귀 가드", () => {
  async function clientScript(): Promise<string> {
    const html = await (await studio.fetch(new Request("http://x/"))).text();
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    return blocks.at(-1) ?? "";
  }

  it("전역 이름이 window의 내장 속성과 충돌하지 않는다", async () => {
    // `var history = []`는 window.history(History 객체)를 못 덮는다 → .map()이 TypeError.
    // 스크립트 맨 위에서 터지면 **아래 전부가 안 돌아** 빈 화면만 남는다. 실제로 당했다.
    const script = await clientScript();
    const declared = [
      ...script.matchAll(/^\s*(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((m) => m[1] as string);

    const RESERVED = [
      "history",
      "location",
      "name",
      "top",
      "parent",
      "self",
      "status",
      "length",
      "origin",
      "closed",
      "frames",
      "opener",
      "screen",
      "navigator",
    ];
    const clashes = declared.filter((d) => RESERVED.includes(d));
    expect(clashes, `window 내장과 충돌: ${clashes.join(", ")}`).toEqual([]);
  });

  it("페이지 HTML은 캐시되지 않는다 — 고쳐도 예전 화면이 나오면 원인 찾기가 지옥이다", async () => {
    const res = await studio.fetch(new Request("http://x/"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("mermaid 없이도 나머지가 돌도록 가드가 있다", async () => {
    const script = await clientScript();
    // CDN 실패가 드롭다운까지 죽이면 안 된다.
    expect(script).toContain('typeof mermaid !== "undefined"');
  });
});

describe("조건부 엣지가 그림에 나온다 (path_map)", () => {
  async function graphOf(id: string) {
    return (await (await studio.fetch(new Request("http://x/api/graph?id=" + id))).json()) as {
      edges: Array<{ from: string; to: string; kind?: string }>;
    };
  }

  it("ReAct 루프가 보인다 — 예전엔 그림에서 통째로 사라졌다", async () => {
    const { edges } = await graphOf("react");
    const cond = edges.filter((e) => e.kind === "conditional");
    expect(cond.map((e) => e.to).sort()).toEqual(["__end__", "tool"]);
    // 돌아오는 길은 정적이라, 둘이 합쳐져야 순환이 그려진다.
    expect(edges).toContainEqual({ from: "tool", to: "model", kind: "static" });
  });

  it("RAG의 Send 팬아웃도 보인다", async () => {
    const { edges } = await graphOf("rag");
    expect(edges).toContainEqual({ from: "retrieve", to: "summarize", kind: "conditional" });
  });

  it("mermaid로 옮길 때 조건부는 점선이 된다", async () => {
    const html = await (await studio.fetch(new Request("http://x/"))).text();
    expect(html).toContain('e.kind === "conditional" ? " -.-> " : " --> "');
  });
});
