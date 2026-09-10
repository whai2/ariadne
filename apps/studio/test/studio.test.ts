import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MemoryStore } from "@ariadne/memory";
import { approvalPolicy, connectMcpAgents } from "../src/agents";
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

  // 아래 두 테스트는 F2.3에서 **의도적으로 대체**됐다. 예전엔 "도구호출: calc" 같은
  // 문자열 규약을 assert했는데, 그건 툴 호출을 흉내 낸 것이지 툴 호출이 아니었다.
  // 회귀 안전망을 깨는 게 아니라, 안전망이 지키던 대상 자체가 바뀐 첫 사례다.
  it("react 예제는 진짜 toolCalls로 돌고 한 턴의 툴 둘이 병렬 실행된다", async () => {
    const { steps } = (await (
      await run("react", { messages: [{ role: "human", content: "3+4랑 5×6 계산해줘" }] })
    ).json()) as {
      steps: Array<{
        nodes: string[];
        state: {
          messages: Array<{
            role: string;
            content: string;
            toolCalls?: Array<{ id: string; name: string }>;
            toolCallId?: string;
          }>;
        };
      }>;
    };
    expect(steps.map((s) => s.nodes)).toEqual([["model"], ["tools"], ["model"]]);

    const messages = steps.at(-1)?.state.messages ?? [];
    // 한 턴에 호출 둘 → toolNode가 병렬로 돌려 **호출 id당 결과 하나**를 순서대로 낸다.
    expect(messages[1]?.toolCalls?.map((c) => c.name)).toEqual(["add", "multiply"]);
    expect(messages.filter((m) => m.role === "tool").map((m) => [m.toolCallId, m.content])).toEqual(
      [
        ["call_1", "7"],
        ["call_2", "30"],
      ],
    );
    expect(messages.at(-1)?.content).toBe("계산 결과: 7 · 30");
  });

  it("react-repair 예제는 스키마 위반을 에러 메시지로 돌려주고 모델이 스스로 고친다", async () => {
    const { steps } = (await (
      await run("react-repair", { messages: [{ role: "human", content: "3+4 계산해줘" }] })
    ).json()) as {
      steps: Array<{
        nodes: string[];
        state: { messages: Array<{ role: string; content: string; status?: string }> };
      }>;
    };
    // 틀린 인자 → 에러 → 고친 인자 → 성공 → 최종 답. 루프가 한 번 더 돈다.
    expect(steps.map((s) => s.nodes)).toEqual([
      ["model"],
      ["tools"],
      ["model"],
      ["tools"],
      ["model"],
    ]);

    const tools = (steps.at(-1)?.state.messages ?? []).filter((m) => m.role === "tool");
    // **던지지 않는다.** 첫 결과는 status:"error"이고 어느 인자가 왜 틀렸는지 담겨 있다.
    expect(tools[0]?.status).toBe("error");
    expect(tools[0]?.content).toContain("expected number, received string");
    expect(tools[1]?.status).toBeUndefined();
    expect(tools[1]?.content).toBe("7");
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

describe("SPA 서빙", () => {
  // S10에서 UI가 React+Vite(web/)로 옮겨갔다 — 인라인 <script> 규약을 검사하던 가드들은
  // 대상 자체가 사라져 제거했다. 그 로직은 이제 web/src의 .tsx에 산다. 서버가 지키는 계약만 남긴다.
  it("GET / 는 HTML을 no-store로 준다(빌드 전이면 안내 페이지)", async () => {
    const res = await studio.fetch(new Request("http://x/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("Ariadne Studio");
  });

  it("모르는 API 경로는 404", async () => {
    const res = await studio.fetch(new Request("http://x/api/zzz"));
    expect(res.status).toBe(404);
  });
});

describe("조건부 엣지가 그림에 나온다 (path_map)", () => {
  async function graphOf(id: string) {
    return (await (await studio.fetch(new Request(`http://x/api/graph?id=${id}`))).json()) as {
      edges: Array<{ from: string; to: string; kind?: string }>;
    };
  }

  it("ReAct 루프가 보인다 — 예전엔 그림에서 통째로 사라졌다", async () => {
    const { edges } = await graphOf("react");
    const cond = edges.filter((e) => e.kind === "conditional");
    // 노드 이름이 "tools"인 건 취향이 아니다 — toolsCondition이 그 문자열을 돌려준다.
    expect(cond.map((e) => e.to).sort()).toEqual(["__end__", "tools"]);
    // 돌아오는 길은 정적이라, 둘이 합쳐져야 순환이 그려진다.
    expect(edges).toContainEqual({ from: "tools", to: "model", kind: "static" });
  });

  it("RAG의 Send 팬아웃도 보인다", async () => {
    const { edges } = await graphOf("rag");
    expect(edges).toContainEqual({ from: "retrieve", to: "summarize", kind: "conditional" });
  });
  // (조건부→점선 변환은 web/src/components/Graph.tsx로 옮겨갔다 — HTML 문자열 검사 제거.)
});

describe("챗 그래프 모양 선택", () => {
  async function shapeGraph(shape: string) {
    return (await (
      await studio.fetch(new Request(`http://x/api/chat/graph?shape=${shape}`))
    ).json()) as { nodes: string[]; edges: Array<{ from: string; to: string; kind?: string }> };
  }

  it("GET /api/shapes — 모양 목록과 호출 횟수(느린 이유)를 준다", async () => {
    const list = (await (await studio.fetch(new Request("http://x/api/shapes"))).json()) as Array<{
      id: string;
      calls: number;
    }>;
    expect(list.map((s) => s.id)).toEqual([
      "single",
      "chain",
      "parallel",
      "loop",
      "dispatch",
      "tools",
    ]);
    for (const s of list) expect(s.calls).toBeGreaterThan(0);
  });

  it("**자격증명 없이도** 구조를 그릴 수 있다 — 보내기 전에 모양을 본다", async () => {
    // spec 없이 빌드하므로 키가 없어도 그림이 나온다. 이게 미리보기의 전제다.
    expect((await shapeGraph("single")).nodes).toEqual(["model"]);
  });

  it("모양마다 구조가 실제로 다르다", async () => {
    expect((await shapeGraph("chain")).nodes).toEqual(["draft", "revise"]);

    // 병렬: START에서 두 갈래 — 한 슈퍼스텝에 같이 돈다(V4).
    const par = await shapeGraph("parallel");
    expect(
      par.edges
        .filter((e) => e.from === "__start__")
        .map((e) => e.to)
        .sort(),
    ).toEqual(["critical", "plain"]);

    // 루프: 자기 자신으로 가는 조건부 엣지(V5) — S6 덕에 그림에 나온다.
    const loop = await shapeGraph("loop");
    expect(loop.edges).toContainEqual({ from: "model", to: "model", kind: "conditional" });
  });

  it("모르는 모양은 400", async () => {
    const res = await studio.fetch(new Request("http://x/api/chat/graph?shape=없는모양"));
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!hasCli)("모양별 실제 실행 (구독 자격증명)", () => {
  it("병렬은 **한 스텝에 두 노드**가 돌고 리듀서가 합친다", async () => {
    const res = (await (
      await studio.fetch(
        new Request("http://x/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spec: "claude-code/sonnet",
            shape: "parallel",
            system: "한 문장으로.",
            messages: [{ role: "human", content: "1+1은?" }],
          }),
        }),
      )
    ).json()) as { messages: unknown[]; steps: Array<{ step: number; nodes: string[] }> };

    expect(res.steps).toHaveLength(1); // 순차였다면 2였을 것
    expect(res.steps[0]?.nodes.sort()).toEqual(["critical", "plain"]);
    expect(res.messages).toHaveLength(2); // 두 쓰기가 messages 리듀서로 합쳐졌다
  }, 180_000);
});

describe("분업 모양 (Send 팬아웃)", () => {
  it("parseTasks — 모델이 JSON을 안 줘도 조용히 죽지 않는다", async () => {
    const { parseTasks } = await import("../src/chat");
    expect(parseTasks('["A", "B"]', "폴백")).toEqual(["A", "B"]);
    expect(parseTasks('앞말\n["A", "B"]\n뒷말', "폴백")).toEqual(["A", "B"]); // 설명이 붙어도 건진다
    expect(parseTasks("그냥 산문 답변", "원래 질문")).toEqual(["원래 질문"]); // 폴백
    expect(parseTasks("[]", "원래 질문")).toEqual(["원래 질문"]); // 빈 배열도 폴백
    expect(parseTasks(JSON.stringify(["a", "b", "c", "d", "e"]), "f")).toHaveLength(4); // 폭주 방지
  });

  it("구조: dispatch가 Send로 worker를 팬아웃한다", async () => {
    const g = (await (
      await studio.fetch(new Request("http://x/api/chat/graph?shape=dispatch"))
    ).json()) as { nodes: string[]; edges: Array<{ from: string; to: string; kind?: string }> };
    expect(g.nodes).toEqual(["dispatch", "worker"]);
    // Send는 라우터 반환값이라 조건부로 그려진다(S6).
    expect(g.edges).toContainEqual({ from: "dispatch", to: "worker", kind: "conditional" });
  });
});

describe.skipIf(!hasCli)("분업이 실제로 나뉜다 (구독 자격증명)", () => {
  it("워커가 **각자 다른 작업**을 받는다 — 병렬 모양과 갈리는 지점", async () => {
    const res = (await (
      await studio.fetch(
        new Request("http://x/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spec: "claude-code/sonnet",
            shape: "dispatch",
            system: "두 문장 이내.",
            messages: [{ role: "human", content: "노션과 클릭업 연결 방법" }],
          }),
        }),
      )
    ).json()) as {
      messages: Array<{ content: string }>;
      steps: Array<{ nodes: string[]; state: { tasks: string[] } }>;
    };

    // dispatch가 쪼갠 뒤, 워커들이 다음 스텝에 병렬로 뜬다.
    expect(res.steps[0]?.nodes).toEqual(["dispatch"]);
    expect(res.steps[0]?.state.tasks.length).toBeGreaterThan(1);
    expect(res.steps[1]?.nodes.length).toBeGreaterThan(1); // worker × N

    // 각 답이 자기 작업 이름을 달고 온다 → 서로 다른 일을 했다는 증거.
    expect(res.messages.length).toBe(res.steps[0]?.state.tasks.length ?? 0);
    expect(res.messages[0]?.content).not.toBe(res.messages[1]?.content);
  }, 240_000);
});

describe("툴 모양 (F2.3 — 챗이 진짜 툴을 쓴다)", () => {
  it("구조: model ⇄ tools 루프. **자격증명 없이도** 그려진다", async () => {
    const g = (await (
      await studio.fetch(new Request("http://x/api/chat/graph?shape=tools"))
    ).json()) as { nodes: string[]; edges: Array<{ from: string; to: string; kind?: string }> };
    expect(g.nodes).toEqual(["model", "tools"]);
    // toolsCondition이 고르는 두 길 — 그림엔 path_map 덕에 점선으로 나온다(S6).
    expect(
      g.edges
        .filter((e) => e.kind === "conditional")
        .map((e) => e.to)
        .sort(),
    ).toEqual(["__end__", "tools"]);
    expect(g.edges).toContainEqual({ from: "tools", to: "model", kind: "static" });
  });

  it("프로바이더 목록이 **네이티브 툴 여부**를 알려준다(쓸 수 있나가 아니라)", async () => {
    const list = (await (
      await studio.fetch(new Request("http://x/api/providers"))
    ).json()) as Array<{
      id: string;
      tools: boolean;
    }>;
    // claude-code만 네이티브가 아니다 — 프롬프트 심으로 흉내 낸다(F2.4). false지만 못 쓴단 뜻이 아니다.
    expect(list.find((p) => p.id === "claude-code")?.tools).toBe(false);
    expect(list.find((p) => p.id === "anthropic")?.tools).toBe(true);
    expect(list.find((p) => p.id === "groq")?.tools).toBe(true);
  });

  // (흉내-모드 안내와 툴 호출 렌더는 web/src의 React로 옮겨갔다 — HTML 문자열 검사 제거.
  //  claude-code=false·anthropic=true 같은 **API 데이터** 계약은 위에서 계속 검사한다.)

  it("**claude-code도 툴 모양에서 빌드된다** — 더는 안 막힌다(F2.4, promptedTools)", async () => {
    // F2.3에선 여기서 ToolsUnsupportedError로 500이었다. 이제 buildChatGraph가 claude-code에
    // promptedTools를 켜서 그래프가 정상으로 선다(모델 생성은 spawn을 안 하므로 CLI도 불필요).
    // 진짜 왕복 검증은 model 링의 결정론적 심 테스트가 맡는다(여긴 CLI 없이 못 돌린다).
    const { buildChatGraph } = await import("../src/chat");
    const g = buildChatGraph("tools", "claude-code/sonnet");
    expect(g.getGraph().nodes).toEqual(["model", "tools"]);
  });
});

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("툴 모양 실제 실행 (API 키)", () => {
  it("**진짜 모델이 툴 링을 통해 툴을 부른다** — F2가 도착한 지점", async () => {
    const res = (await (
      await studio.fetch(
        new Request("http://x/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spec: "anthropic/claude-sonnet-4-5",
            shape: "tools",
            messages: [{ role: "human", content: "3+4랑 5×6을 계산해줘." }],
          }),
        }),
      )
    ).json()) as {
      messages: Array<{ role: string; content: string; toolCalls?: Array<{ name: string }> }>;
      steps: Array<{ nodes: string[] }>;
    };

    expect(res.steps.map((s) => s.nodes)).toContainEqual(["tools"]);
    const called = res.messages.flatMap((m) => m.toolCalls ?? []).map((c) => c.name);
    expect(called).toContain("add");
    expect(called).toContain("multiply");
    // 마지막은 산문이어야 한다 — 답 없는 tool_use로 끝나면 다음 턴이 400이다.
    expect(res.messages.at(-1)?.toolCalls).toBeUndefined();
    expect(res.messages.at(-1)?.content).not.toBe("");
  }, 180_000);
});

describe("Agents (사이드바) — S9", () => {
  async function json(path: string, init?: RequestInit) {
    return (await (await studio.fetch(new Request(`http://x${path}`, init))).json()) as never;
  }

  it("GET /api/agents 는 등록된 에이전트를 설정과 함께 준다", async () => {
    const list = (await json("/api/agents")) as Array<{
      id: string;
      tools: string[];
      model: string;
      toolsNative: boolean;
    }>;
    const calc = list.find((a) => a.id === "calculator");
    const assistant = list.find((a) => a.id === "assistant");
    expect(calc?.tools).toEqual(["add", "multiply", "now"]);
    expect(assistant?.tools).toEqual([]); // 툴 없는 에이전트
    // 기본 프로바이더가 claude-code라 네이티브 툴은 못 실어 프롬프트 흉내(F2.4).
    expect(calc?.toolsNative).toBe(false);
    expect(calc?.model).toBe("claude-code/sonnet");
  });

  it("GET /api/agents/graph 는 자격증명 없이 그래프를 준다 — 툴이 있으면 model⇄tools 루프", async () => {
    // 툴 에이전트: model·tools 노드 + 조건부 엣지 + tools→model 정적 엣지.
    const g = (await json("/api/agents/graph?id=calculator")) as {
      nodes: string[];
      edges: Array<{ from: string; to: string; kind: string }>;
    };
    expect(g.nodes).toEqual(["model", "tools"]);
    expect(g.edges).toContainEqual({ from: "tools", to: "model", kind: "static" });
    expect(
      g.edges
        .filter((e) => e.from === "model" && e.kind === "conditional")
        .map((e) => e.to)
        .sort(),
    ).toEqual(["__end__", "tools"]);
  });

  it("툴 없는 에이전트는 단발 호출 그래프 — model→END, tools 노드 없음", async () => {
    const g = (await json("/api/agents/graph?id=assistant")) as {
      nodes: string[];
      edges: Array<{ from: string; to: string; kind: string }>;
    };
    expect(g.nodes).toEqual(["model"]);
    expect(g.edges).toContainEqual({ from: "model", to: "__end__", kind: "static" });
  });

  it("모르는 에이전트 id 는 404", async () => {
    const res = await studio.fetch(new Request("http://x/api/agents/graph?id=nope"));
    expect(res.status).toBe(404);
  });

  it("POST /api/agents/chat 은 messages가 없으면 400", async () => {
    const res = await studio.fetch(
      new Request("http://x/api/agents/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "calculator", messages: [] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // (사이드바·에이전트 상세는 web/src의 React 컴포넌트다 — DOM 문자열 검사 대신
  //  서버 계약(/api/agents, /api/agents/graph, /api/agents/chat)을 위에서 검사한다.)
});

// MCP 에이전트는 **진짜 서버를 띄운다**(자식 프로세스 + JSON-RPC). 네트워크 0.
// connectMcpAgents가 툴을 채운 뒤로는 로컬 툴 에이전트와 계약이 똑같아야 한다 — 그게 요점이다.
describe("MCP 에이전트 — 툴이 외부 서버에서 온다 (F3.2)", () => {
  let closeMcp: () => Promise<void>;

  beforeAll(async () => {
    closeMcp = await connectMcpAgents();
  });
  afterAll(async () => {
    await closeMcp();
  });

  async function json(path: string) {
    return (await (await studio.fetch(new Request(`http://x${path}`))).json()) as never;
  }

  it("툴이 채워지고 **서버 이름**이 실린다 — 우리가 한 줄도 안 적은 툴들", async () => {
    const list = (await json("/api/agents")) as Array<{
      id: string;
      tools: string[];
      mcpServer?: string;
    }>;
    const mcp = list.find((a) => a.id === "mcp");
    // 데모 서버가 준 세 툴이 그대로 실린다.
    expect(mcp?.tools.sort()).toEqual(["get_weather", "word_count", "write_note"]);
    // serverInfo로 붙은 서버의 정체가 드러난다.
    expect(mcp?.mcpServer).toBe("ariadne-studio-demo");
  });

  it("그래프가 **로컬 툴 에이전트와 똑같다** — model ⇄ tools 루프", async () => {
    const g = (await json("/api/agents/graph?id=mcp")) as {
      nodes: string[];
      edges: Array<{ from: string; to: string; kind: string }>;
    };
    // 계산기 에이전트와 같은 모양 — 툴이 원격인 걸 그래프는 모른다.
    // (엣지 종류는 이 에이전트에 승인 게이트가 걸려 조건부다 — MCP 때문이 아니라 F3.3 때문.)
    expect(g.nodes).toEqual(["model", "tools"]);
    expect(g.edges).toContainEqual({ from: "tools", to: "model", kind: "conditional" });
    expect(
      g.edges
        .filter((e) => e.from === "model" && e.kind === "conditional")
        .map((e) => e.to)
        .sort(),
    ).toEqual(["__end__", "tools"]);
  });

  // **진짜 기성 서버**(@modelcontextprotocol/server-filesystem, npx)에 붙는 에이전트.
  // npx 다운로드·네트워크가 필요해 오프라인이면 못 붙는데, 그때도 스튜디오는 떠야 한다 —
  // 그래서 "붙었으면 진짜 서버 티가 나고, 못 붙었으면 이유가 실린다" 둘 중 하나를 검증한다.
  it("붙으면 진짜 서버가, 못 붙으면 이유가 실린다 — 한 서버가 죽어도 스튜디오는 산다", async () => {
    const list = (await json("/api/agents")) as Array<{
      id: string;
      tools: string[];
      mcpServer?: string;
      mcpError?: string;
    }>;
    const fs = list.find((a) => a.id === "filesystem");
    expect(fs).toBeDefined();
    if (fs?.mcpError === undefined) {
      // 붙었다 — 그 서버가 준 진짜 파일 툴이 실렸는지.
      expect(fs?.mcpServer).toBe("secure-filesystem-server");
      expect(fs?.tools).toContain("list_directory");
      expect(fs?.tools).toContain("read_text_file");
    } else {
      // 못 붙었다(오프라인 등) — 데모 에이전트는 여전히 멀쩡해야 한다(격리 검증).
      expect(list.find((a) => a.id === "mcp")?.tools.length).toBeGreaterThan(0);
    }
  });
});

// 승인 게이트가 스튜디오 계약으로 드러나는가 (S12 / F3.3).
// **서버가 상태를 안 든다** — 재개는 같은 엔드포인트에 `decision` 한 글자를 더 싣는 것뿐이라,
// 여기서 검사할 건 "무엇이 응답에 실리는가"와 "그래프 모양이 갈리는가" 둘이다.
describe("승인 게이트 — 스튜디오 계약 (F3.3)", () => {
  let closeMcp: () => Promise<void>;

  beforeAll(async () => {
    closeMcp = await connectMcpAgents();
  });
  afterAll(async () => {
    await closeMcp();
  });

  async function json(path: string) {
    return (await (await studio.fetch(new Request(`http://x${path}`))).json()) as never;
  }

  it("승인이 걸린 툴 이름이 목록에 실린다 — UI가 칩에 자물쇠를 다는 근거", async () => {
    const list = (await json("/api/agents")) as Array<{
      id: string;
      tools: string[];
      approval?: string[];
    }>;
    const mcp = list.find((a) => a.id === "mcp");
    expect(mcp?.approval).toEqual(["write_note"]);
    // 읽기 툴은 안 걸린다 — 게이트가 전부를 막으면 게이트가 아니라 벽이다.
    expect(mcp?.approval).not.toContain("get_weather");

    // 게이트 없는 에이전트는 필드 자체가 없다(있던 계약이 안 바뀐다).
    expect(list.find((a) => a.id === "calculator")?.approval).toBeUndefined();
  });

  it("실제로 안 붙은 툴은 '승인 필요'에서 빠진다 — 서버가 안 떠도 거짓말을 안 한다", async () => {
    const list = (await json("/api/agents")) as Array<{
      id: string;
      tools: string[];
      approval?: string[];
      mcpError?: string;
    }>;
    const fs = list.find((a) => a.id === "filesystem");
    // 붙었으면 선언한 쓰기 툴 중 실재하는 것만, 못 붙었으면 빈 배열.
    for (const name of fs?.approval ?? []) {
      expect(fs?.tools).toContain(name);
    }
    if (fs?.mcpError !== undefined) expect(fs.approval).toEqual([]);
  });

  it("게이트가 걸리면 그래프에 정적 엣지가 사라진다 — 멈추려면 취소 가능한 제어흐름이어야 한다", async () => {
    const gated = (await json("/api/agents/graph?id=mcp")) as {
      nodes: string[];
      edges: Array<{ from: string; to: string; kind: string }>;
    };
    const plain = (await json("/api/agents/graph?id=calculator")) as typeof gated;

    // 노드는 둘 다 같다 — 승인은 새 노드를 안 만든다.
    expect(gated.nodes).toEqual(plain.nodes);
    // 갈리는 건 엣지의 종류뿐이다.
    expect(gated.edges.filter((e) => e.kind === "static")).toEqual([]);
    expect(plain.edges).toContainEqual({ from: "__start__", to: "model", kind: "static" });
    // 게이트 그래프에만 있는 두 갈래: 재개 진입(START→tools)과 멈춤 이탈(tools→END).
    expect(gated.edges).toContainEqual({ from: "__start__", to: "tools", kind: "conditional" });
    expect(gated.edges).toContainEqual({ from: "tools", to: "__end__", kind: "conditional" });
  });

  it("decision은 allow/deny만 받는다 — 'ask'는 클라이언트가 보낼 수 없다", async () => {
    const post = (body: unknown) =>
      studio.fetch(
        new Request("http://x/api/agents/chat", { method: "POST", body: JSON.stringify(body) }),
      );
    const messages = [{ role: "human", content: "안녕" }];
    // 사람에게 묻겠다는 뜻인데 요청을 보낸 쪽이 이미 사람이라, 받으면 무한 왕복이 된다.
    expect((await post({ id: "mcp", messages, decision: "ask" })).status).toBe(400);
    expect((await post({ id: "mcp", messages, decision: "무엇" })).status).toBe(400);
  });
});

// 진짜 모델로 **멈췄다 재개**되는지. 구독 자격증명(claude CLI)만 쓰고 API 키는 안 쓴다.
describe.skipIf(!hasCli)("승인 게이트 → 진짜 모델로 멈춤·재개 (구독 자격증명)", () => {
  let closeMcp: () => Promise<void>;

  beforeAll(async () => {
    closeMcp = await connectMcpAgents();
  });
  afterAll(async () => {
    await closeMcp();
  });

  function turn(messages: unknown[], decision?: string) {
    return studio.fetch(
      new Request("http://x/api/agents/chat", {
        method: "POST",
        body: JSON.stringify({ id: "mcp", messages, decision }),
      }),
    );
  }

  it("쓰기 툴 앞에서 멈추고, 승인하면 이어 돈다", async () => {
    const first = [
      { role: "human", content: "'회의록'이라는 제목으로 '내일 3시'라고 메모 저장해줘" },
    ];
    const paused = (await (await turn(first)).json()) as {
      messages: Array<Record<string, unknown>>;
      pending: Array<{ name: string }>;
    };

    // 멈췄다: 대기 중인 호출이 실리고, 그건 우리가 승인 목록에 올린 그 툴이다.
    expect(paused.pending.map((c) => c.name)).toEqual(["write_note"]);
    // 툴 결과 메시지는 하나도 없다 — 아직 아무 일도 안 일어났다.
    expect(paused.messages.some((m) => m.role === "tool")).toBe(false);

    // 재개: **같은 엔드포인트**에 이력 + decision 한 글자.
    const history = [...first, ...paused.messages];
    const resumed = (await (await turn(history, "allow")).json()) as {
      messages: Array<Record<string, unknown>>;
      steps: Array<{ nodes: string[] }>;
      pending: unknown[];
    };

    // model을 다시 안 부르고 tools부터 시작한다(답 없는 tool_use를 되보내면 안 되므로).
    expect(resumed.steps[0]?.nodes).toEqual(["tools"]);
    expect(resumed.messages.some((m) => m.role === "tool")).toBe(true);
    expect(resumed.pending).toEqual([]);
  }, 120_000);

  it("거부하면 툴은 안 돌고 모델이 다른 길을 찾는다", async () => {
    const first = [{ role: "human", content: "'메모'라는 제목으로 '테스트'라고 저장해줘" }];
    const paused = (await (await turn(first)).json()) as {
      messages: Array<Record<string, unknown>>;
      pending: Array<{ name: string }>;
    };
    expect(paused.pending.length).toBeGreaterThan(0);

    const denied = (await (await turn([...first, ...paused.messages], "deny")).json()) as {
      messages: Array<Record<string, unknown>>;
      pending: unknown[];
    };
    // 거부도 툴 결과다 — id 짝이 맞고 status가 error다(그래서 모델이 읽고 계속 돈다).
    const results = denied.messages.filter((m) => m.role === "tool");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.status).toBe("error");
    expect(denied.pending).toEqual([]);
  }, 120_000);
});

// 메모리 기록이 스튜디오 계약으로 드러나는가 (F4.1).
// **동작은 하나도 안 바뀐다** — 위 52개 테스트가 스토어 없이 그대로 통과하는 게 그 증거다.
// 여기선 스토어를 준 스튜디오를 따로 세워 "무엇이 쌓이나"만 본다.
describe("메모리 기록 — 겪은 일과 가치 신호 (F4.1)", () => {
  it("스토어를 안 주면 /api/memory는 비어 있고 아무것도 안 쌓인다", async () => {
    const res = await studio.fetch(new Request("http://x/api/memory"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ episodes: [], events: [] });
  });

  it("approvalPolicy는 게이트를 촉발한 이름만 기록한다 — 묶음 승격이 집계를 오염시키지 않는다", async () => {
    const seen: Array<[string, string[]]> = [];
    const policy = approvalPolicy(["write_note"], undefined, {
      onDecision: (kind, targets) => seen.push([kind, [...targets]]),
    });

    // 안전한 툴만 부른 묶음 → 통과하고, 기록엔 위험한 이름이 없다(빈 배열).
    expect(await policy([{ id: "c1", name: "get_weather", args: {} }])).toBe("allow");
    expect(seen).toEqual([["allow", []]]);

    // 위험한 툴이 끼면 "ask"다 — **사람의 결정이 아니라 시스템 상태라 기록하지 않는다.**
    expect(
      await policy([
        { id: "c2", name: "get_weather", args: {} },
        { id: "c3", name: "write_note", args: {} },
      ]),
    ).toBe("ask");
    expect(seen.length).toBe(1);
  });

  it("재개 결정은 그 묶음의 위험한 이름과 함께 기록된다", async () => {
    const seen: Array<[string, string[]]> = [];
    const policy = approvalPolicy(["write_note"], "deny", {
      onDecision: (kind, targets) => seen.push([kind, [...targets]]),
    });
    expect(await policy([{ id: "c1", name: "write_note", args: { title: "x" } }])).toBe("deny");
    expect(seen).toEqual([["deny", ["write_note"]]]);

    // 한 번 쓰고 버린다(F3.3) — 같은 run의 다음 묶음은 다시 게이트로 간다.
    expect(await policy([{ id: "c2", name: "write_note", args: {} }])).toBe("ask");
    expect(seen.length).toBe(1);
  });

  it("agentTurn이 에피소드를 열고 닫는다 — 툴 없는 에이전트로 모델 없이도 계약이 보인다", async () => {
    const memory = MemoryStore.open(":memory:", { now: () => 7 });
    const withMemory = createStudio(examples, memory);

    const res = await withMemory.fetch(new Request("http://x/api/memory?agent=assistant"));
    expect(await res.json()).toEqual({ episodes: [], events: [] });

    // 모델이 없어도(자격증명 없음) 에피소드는 열리고 **finally가 닫는다** —
    // 실패한 run이 running으로 남으면 관찰이 거짓말이 된다.
    await withMemory.fetch(
      new Request("http://x/api/agents/chat", {
        method: "POST",
        body: JSON.stringify({ id: "assistant", messages: [{ role: "human", content: "안녕" }] }),
      }),
    );
    const after = (await (
      await withMemory.fetch(new Request("http://x/api/memory?agent=assistant"))
    ).json()) as {
      episodes: Array<{ status: string; ended_at: number | null; input_count: number }>;
    };

    expect(after.episodes.length).toBe(1);
    expect(after.episodes[0]?.ended_at).not.toBeNull();
    expect(after.episodes[0]?.input_count).toBe(1);
    memory.close();
  });
});

// 진짜 모델로 **거부가 가치 채널에 남는지**. 구독 자격증명만 쓰고 API 키는 안 쓴다.
describe.skipIf(!hasCli)("메모리 기록 → 진짜 모델 (구독 자격증명)", () => {
  let closeMcp: () => Promise<void>;

  beforeAll(async () => {
    closeMcp = await connectMcpAgents();
  });
  afterAll(async () => {
    await closeMcp();
  });

  it("멈춤과 재개가 **에피소드 두 행**으로 남고 그 사이에 deny가 하나 낀다", async () => {
    const memory = MemoryStore.open();
    const s = createStudio(examples, memory);
    const turn = (messages: unknown[], decision?: string) =>
      s.fetch(
        new Request("http://x/api/agents/chat", {
          method: "POST",
          body: JSON.stringify({ id: "mcp", messages, decision }),
        }),
      );

    const first = [{ role: "human", content: "'회의'라는 제목으로 '3시'라고 메모 저장해줘" }];
    const paused = (await (await turn(first)).json()) as {
      messages: unknown[];
      pending: Array<{ name: string }>;
    };
    expect(paused.pending.map((c) => c.name)).toEqual(["write_note"]);

    // 멈춘 턴: paused로 닫혔고, 아직 사람이 아무것도 안 골라서 가치 이벤트가 없다.
    let mem = (await (await s.fetch(new Request("http://x/api/memory?agent=mcp"))).json()) as {
      episodes: Array<{ status: string }>;
      events: Array<{ kind: string; target: string }>;
    };
    expect(mem.episodes.map((e) => e.status)).toEqual(["paused"]);
    expect(mem.events).toEqual([]);

    // 거부로 재개 — **새 에피소드**가 되고, 그 안에서 사람의 결정이 기록된다.
    await turn([...first, ...paused.messages], "deny");
    mem = (await (
      await s.fetch(new Request("http://x/api/memory?agent=mcp"))
    ).json()) as typeof mem;

    expect(mem.episodes.length).toBe(2); // 서버는 두 run을 잇지 않는다
    expect(mem.episodes[0]?.status).toBe("completed"); // 최신순 — 재개 턴은 끝까지 갔다
    expect(mem.events.map((e) => [e.kind, e.target])).toEqual([["deny", "write_note"]]);
    memory.close();
  }, 180_000);
});
