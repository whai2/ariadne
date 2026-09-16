import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chooseFact, MemoryStore, type ScoredFact } from "@ariadne/memory";
import { approvalPolicy, buildAgentGraph, composeSystem } from "../src/domain/graph";
import { agents, connectMcpAgents } from "../src/domain/registry";
import { createStudio } from "../src/studio";

/** 저장소 없이 뜬 스튜디오. **메모리가 없어도 그냥 돈다**는 게 계약이다. */
const studio = createStudio();
afterAll(() => studio.close());

async function start(s = studio): Promise<string> {
  const res = await s.fetch(
    new Request("http://x/api/threads", {
      method: "POST",
      body: JSON.stringify({ agentId: "mcp" }),
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
function postTurn(s: ReturnType<typeof createStudio>, id: string, input: unknown) {
  return s.fetch(
    new Request(`http://x/api/threads/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}
async function firstTurn(s: ReturnType<typeof createStudio>, text: string) {
  return postTurn(s, await start(s), { message: text });
}

/** 구독 자격증명이 있나 — 진짜 모델을 부르는 블록은 이게 없으면 통째로 건너뛴다. */
const hasCli = Bun.spawnSync(["which", "claude"]).exitCode === 0;

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

describe("Agents (사이드바) — S9", () => {
  async function json(path: string, init?: RequestInit) {
    return (await (await studio.fetch(new Request(`http://x${path}`, init))).json()) as never;
  }

  it("GET /api/agents 는 등록된 에이전트를 설정과 함께 준다", async () => {
    const list = (await json("/api/agents")) as Array<{
      id: string;
      model: string;
      toolsNative: boolean;
      approval?: string[];
    }>;
    // **둘 다 승인 게이트가 걸려 있다** — 게이트가 가치 신호의 유일한 출처라, 이 목록의
    // 조건이 곧 "메모리 루프에 기여하는가"다. **선언**을 보는 게 요점이다: 직렬화된
    // `approval`은 실제로 붙은 툴로 걸러지므로 MCP 연결 전엔 비어 있다(거짓말을 안 한다).
    expect(list.map((a) => a.id).sort()).toEqual(["filesystem", "mcp"]);
    expect(agents.every((a) => (a.approval?.length ?? 0) > 0)).toBe(true);

    const mcp = list.find((a) => a.id === "mcp");
    // 기본 프로바이더가 claude-code라 네이티브 툴은 못 실어 프롬프트 흉내(F2.4).
    expect(mcp?.toolsNative).toBe(false);
    expect(mcp?.model).toBe("claude-code/sonnet");
  });

  it("MCP 툴이 채워지기 전엔 단발 호출 그래프 — 툴 유무만으로 모양이 갈린다", async () => {
    // 이 블록은 connectMcpAgents 전에 돈다 → def.tools가 비어 있다. 승인 선언이 있어도
    // 게이트를 안 건다(감쌀 툴이 없으면 링이 ApprovalWithoutToolsError로 던지므로).
    const g = (await json("/api/agents/graph?id=mcp")) as {
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

  it("기존 POST /api/agents/chat은 제거됐다", async () => {
    const res = await studio.fetch(
      new Request("http://x/api/agents/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "mcp", messages: [] }),
      }),
    );
    expect(res.status).toBe(404);
  });

  // (사이드바·에이전트 상세는 web/src의 React 컴포넌트다 — DOM 문자열 검사 대신
  //  서버 계약(/api/agents, /api/agents/graph, /api/threads)을 위에서 검사한다.)
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
// F5.4에서는 서버가 상태를 소유한다. 승인 정책과 그래프 구조는 그대로 유지한다.
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

    // 에이전트마다 목록이 다르다 — 무엇이 위험한지는 서버가 안 알려주므로 우리가 정한다.
    expect(list.find((a) => a.id === "filesystem")?.approval).not.toEqual(mcp?.approval);
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
    // 비교 대상은 **같은 에이전트에서 승인 선언만 뺀 것**이다. 등록 목록엔 게이트 없는
    // 에이전트가 더 이상 없어서인데, 오히려 이게 더 정확한 대조군이다 — 툴도 모델도 같고
    // 바뀐 게 `approval` 하나뿐이라, 차이가 나면 그건 승인 때문이다.
    const mcpDef = agents.find((a) => a.id === "mcp");
    if (mcpDef === undefined) throw new Error("mcp 에이전트가 없다");
    const { approval: _drop, ...ungated } = mcpDef;
    const plain = buildAgentGraph(ungated, true).getGraph() as typeof gated;

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
    const id = await start();
    expect((await postTurn(studio, id, { decision: "ask" })).status).toBe(400);
    expect((await postTurn(studio, id, { decision: "무엇" })).status).toBe(400);
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

  it("쓰기 툴 앞에서 멈추고, 승인하면 이어 돈다", async () => {
    const first = [
      { role: "human", content: "'회의록'이라는 제목으로 '내일 3시'라고 메모 저장해줘" },
    ];
    const id = await start();
    const paused = (await (await postTurn(studio, id, { message: first[0]?.content })).json()) as {
      messages: Array<Record<string, unknown>>;
      pending: Array<{ name: string }>;
    };

    // 멈췄다: 대기 중인 호출이 실리고, 그건 우리가 승인 목록에 올린 그 툴이다.
    expect(paused.pending.map((c) => c.name)).toEqual(["write_note"]);
    // 툴 결과 메시지는 하나도 없다 — 아직 아무 일도 안 일어났다.
    expect(paused.messages.some((m) => m.role === "tool")).toBe(false);

    // 재개: 같은 thread에 승인 결정만 전달한다.
    const resumed = (await (await postTurn(studio, id, { decision: "allow" })).json()) as {
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
    const id = await start();
    const paused = (await (await postTurn(studio, id, { message: first[0]?.content })).json()) as {
      messages: Array<Record<string, unknown>>;
      pending: Array<{ name: string }>;
    };
    expect(paused.pending.length).toBeGreaterThan(0);

    const denied = (await (await postTurn(studio, id, { decision: "deny" })).json()) as {
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
    expect(await res.json()).toEqual({ episodes: [], events: [], facts: [] });
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

  it("agentTurn이 에피소드를 열고 닫는다 — 모델이 없어도(던져도) 계약이 보인다", async () => {
    const memory = MemoryStore.open(":memory:", { now: () => 7 });
    const withMemory = createStudio(memory);

    const res = await withMemory.fetch(new Request("http://x/api/memory?agent=mcp"));
    expect(await res.json()).toEqual({ episodes: [], events: [], facts: [] });

    // 모델이 없어도(자격증명 없음) 에피소드는 열리고 **finally가 닫는다** —
    // 실패한 run이 running으로 남으면 관찰이 거짓말이 된다.
    await firstTurn(withMemory, "안녕");
    const after = (await (
      await withMemory.fetch(new Request("http://x/api/memory?agent=mcp"))
    ).json()) as {
      episodes: Array<{ status: string; ended_at: number | null; input_count: number }>;
    };

    expect(after.episodes.length).toBe(1);
    expect(after.episodes[0]?.ended_at).not.toBeNull();
    expect(after.episodes[0]?.input_count).toBe(1);
    memory.close();
    // claude CLI가 있으면 진짜 모델을 부르므로 기본 5초로는 모자란다. 성공하든 던지든
    // **어느 쪽이든 finally가 닫는다**는 게 이 테스트가 지키는 것이라 둘 다 통과해야 한다.
  }, 120_000);
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
    const s = createStudio(memory);
    const id = await start(s);

    const first = [{ role: "human", content: "'회의'라는 제목으로 '3시'라고 메모 저장해줘" }];
    const paused = (await (await postTurn(s, id, { message: first[0]?.content })).json()) as {
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
    await postTurn(s, id, { decision: "deny" });
    mem = (await (
      await s.fetch(new Request("http://x/api/memory?agent=mcp"))
    ).json()) as typeof mem;

    expect(mem.episodes.length).toBe(2); // 같은 thread의 실행도 에피소드는 run마다 남는다
    expect(mem.episodes[0]?.status).toBe("completed"); // 최신순 — 재개 턴은 끝까지 갔다
    expect(mem.events.map((e) => [e.kind, e.target])).toEqual([["deny", "write_note"]]);
    memory.close();
  }, 180_000);
});

// 기억한 사실이 **프롬프트로 흘러가는가** (F4.2).
// 핵심은 `createAgent`도 core도 안 고쳤다는 것이다 — 이미 열려 있던 system 경로를 썼을 뿐이다.
describe("메모리 주입 — 사실이 system으로 간다 (F4.2)", () => {
  const fact = (over: Partial<ScoredFact> = {}): ScoredFact => ({
    id: 1,
    agent: "fs",
    text: "사용자는 write_file이(가) 확인 없이 실행되는 것을 원하지 않는다.",
    target: "write_file",
    level: "preference",
    origin: "deny 2 / allow 0",
    created_at: 1,
    trials: 0,
    strength: 0,
    ...over,
  });

  it("사실이 없으면 system이 **그대로**다 — 빈 블록을 안 붙인다", () => {
    expect(composeSystem("너는 비서다.", [])).toBe("너는 비서다.");
    expect(composeSystem(undefined, [])).toBeUndefined();
  });

  it("사실을 **맨 뒤에** 붙인다 — 사용자 지시 뒤에 와야 덜 묻힌다", () => {
    const out = composeSystem("너는 비서다.", [fact()]);
    expect(out?.startsWith("너는 비서다.")).toBe(true);
    expect(out).toContain("[기억한 것]");
    expect(out).toContain("확인 없이 실행되는 것을 원하지 않는다");
  });

  it("system이 없어도 사실만으로 붙는다", () => {
    expect(composeSystem(undefined, [fact()])).toContain("[기억한 것]");
  });

  it("여러 사실은 줄 단위로 나열된다", () => {
    const out = composeSystem("base", [fact(), fact({ id: 2, text: "두 번째." })]);
    expect(out?.split("\n").filter((l) => l.startsWith("- ")).length).toBe(2);
  });

  it("사실을 줘도 **그래프 모양은 안 바뀐다** — 주입은 실행 개념이 아니라 문자열이다", () => {
    const plain = buildAgentGraph(agents[0] as never, true).getGraph();
    const withFact = buildAgentGraph(agents[0] as never, true, undefined, undefined, [
      fact({ agent: "다른-에이전트" }),
    ]).getGraph();
    expect(withFact).toEqual(plain);
  });

  it("공고화는 거부 2회부터 — 그 전엔 주입할 게 없다", () => {
    const memory = MemoryStore.open();
    const ep = memory.beginEpisode("fs", []);
    memory.recordValueEvent(ep, "fs", "deny", ["write_file"]);
    expect(memory.consolidate("fs")).toBe(0);

    memory.recordValueEvent(ep, "fs", "deny", ["write_file"]);
    expect(memory.consolidate("fs")).toBe(3);
    // 스튜디오가 주입하는 건 그중 선호형 하나뿐이다(선택 기계는 아직 없다).
    expect(memory.facts("fs").filter((f) => f.level === "preference").length).toBe(1);
    memory.close();
  });

  it("GET /api/memory?agent= 는 사실도 준다", async () => {
    const memory = MemoryStore.open();
    const s = createStudio(memory);
    const ep = memory.beginEpisode("mcp", []);
    memory.recordValueEvent(ep, "mcp", "deny", ["write_note"]);
    memory.recordValueEvent(ep, "mcp", "deny", ["write_note"]);
    memory.consolidate("mcp");

    const body = (await (await s.fetch(new Request("http://x/api/memory?agent=mcp"))).json()) as {
      facts: Array<{ level: string; target: string }>;
    };
    expect(body.facts.map((f) => f.level)).toEqual(["episodic", "preference", "rule"]);
    expect(body.facts.every((f) => f.target === "write_note")).toBe(true);
    memory.close();
  });
});

// 선택 기계가 스튜디오 계약으로 드러나는가 (F4.3).
// **하드코딩을 걷어낸 게 이 단계다** — F4.2까지는 level === "preference"를 손으로 걸렀다.
describe("선택 기계 — 쓰이는 것이 남는다 (F4.3)", () => {
  /** 거부 2회로 후보 셋을 만든 스토어. */
  function seeded() {
    const memory = MemoryStore.open();
    const ep = memory.beginEpisode("mcp", []);
    memory.recordValueEvent(ep, "mcp", "deny", ["write_note"]);
    memory.recordValueEvent(ep, "mcp", "deny", ["write_note"]);
    memory.consolidate("mcp");
    return memory;
  }

  it("GET /api/memory 가 **성적까지** 준다 — 누가 이기고 지는지가 관찰의 전부다", async () => {
    const memory = seeded();
    const s = createStudio(memory);
    const body = (await (await s.fetch(new Request("http://x/api/memory?agent=mcp"))).json()) as {
      facts: Array<{ level: string; trials: number; strength: number }>;
    };
    expect(body.facts.map((f) => f.level)).toEqual(["episodic", "preference", "rule"]);
    expect(body.facts.every((f) => f.trials === 0 && f.strength === 0)).toBe(true);
    memory.close();
  });

  it("이번 턴에 고르는 건 **하나**다 — 셋을 동시에 넣으면 귀속이 안 된다", () => {
    const memory = seeded();
    const chosen = chooseFact(memory.scoredFacts("mcp"));
    expect(chosen).toBeDefined();
    // 그리고 그게 선호형이라는 보장이 **없다** — 하드코딩을 걷어냈으므로.
    expect(
      composeSystem("base", [chosen as never])
        ?.split("\n")
        .filter((l) => l.startsWith("- ")).length,
    ).toBe(1);
    memory.close();
  });

  it("주입한 턴이 시행으로 남는다 — 모델 없이도 계약이 보인다", async () => {
    const memory = seeded();
    const s = createStudio(memory);
    await firstTurn(s, "안녕");
    // 모델이 있든(진짜 호출) 없든(던짐) 에피소드는 닫힌다. 시행은 **끝까지 돈 경우에만** 센다.
    const total = memory.scoredFacts("mcp").reduce((n, f) => n + f.trials, 0);
    expect(total).toBeLessThanOrEqual(1);
    memory.close();
  }, 120_000);

  it("사실이 없는 에이전트는 아무것도 안 고른다 — 주입도 시행도 없다", () => {
    const memory = MemoryStore.open();
    expect(chooseFact(memory.scoredFacts("사실이-없는-에이전트"))).toBeUndefined();
    expect(composeSystem("base", [])).toBe("base");
    memory.close();
  });
});

// 쌓인 기억을 화면이 읽을 수 있는가 (S13).
// **관찰의 구멍이 하나 있었다** — 사실이 system에 접혀 들어가 모델만 보므로, 3턴째에 행동이
// 바뀌어도 화면에는 원인 없이 나타났다. `/api/memory`는 "쌓인 것"을 줄 뿐 *이번 턴에 어느 것을
// 썼는지*는 말하지 않는다. 그래서 응답에 `injected`를 싣는다(S12의 `pending`과 같은 모양).
describe("메모리 뷰 — 주입이 관찰된다 (S13)", () => {
  function seeded() {
    const memory = MemoryStore.open();
    const ep = memory.beginEpisode("mcp", []);
    memory.recordValueEvent(ep, "mcp", "deny", ["write_note"]);
    memory.recordValueEvent(ep, "mcp", "deny", ["write_note"]);
    memory.consolidate("mcp");
    return memory;
  }

  async function turn(s: ReturnType<typeof createStudio>, text: string) {
    const res = await firstTurn(s, text);
    return (await res.json()) as {
      injected?: { fact: ScoredFact; outcome: string | null };
      error?: string;
    };
  }

  it.skipIf(!hasCli)(
    "응답이 **이번 턴에 시험한 사실 하나**를 싣는다 — 그게 화면이 원인을 말할 유일한 근거다",
    async () => {
      const memory = seeded();
      const s = createStudio(memory);
      const body = await turn(s, "안녕");
      expect(body.error).toBeUndefined();
      expect(body.injected).toBeDefined();

      // 고른 것이 실제로 이 에이전트의 사실 중 하나이고, 판정이 DB와 **같은 값**이다.
      const facts = memory.scoredFacts("mcp");
      const fact = body.injected?.fact as ScoredFact;
      expect(facts.map((f) => f.id)).toContain(fact.id);
      expect(facts.find((f) => f.id === fact.id)?.trials).toBe(1);
      // 판정이 났으면 시행이 하나 늘었고, 응답의 outcome이 그 시행의 결과다.
      expect(["reinforce", "decay", "neutral"]).toContain(body.injected?.outcome as string);
      memory.close();
    },
    120_000,
  );

  it.skipIf(!hasCli)(
    "사실이 없으면 `injected` 키가 **아예 없다** — 비면 안 싣는다(F2.1의 규칙)",
    async () => {
      const memory = MemoryStore.open();
      const s = createStudio(memory);
      const body = await turn(s, "안녕");
      expect(body.error).toBeUndefined();
      expect("injected" in body).toBe(false);
      memory.close();
    },
    120_000,
  );

  it("스토어가 없어도 응답에 injected가 없다 — 메모리 없이도 그냥 돈다는 계약", async () => {
    const temporary = createStudio();
    try {
      const body = await turn(temporary, "안녕");
      expect("injected" in body).toBe(false);
    } finally {
      temporary.close();
    }
  }, 120_000);
});

describe("체크포인트 — 예산 스키마 (F5.2)", () => {
  let closeMcp: () => Promise<void>;

  beforeAll(async () => {
    closeMcp = await connectMcpAgents();
  });
  afterAll(async () => {
    await closeMcp();
  });

  it("예산 선언이 목록에 실리고, 그래프에 채널로 낮춰진다", async () => {
    const list = (await (await studio.fetch(new Request("http://x/api/agents"))).json()) as Array<{
      id: string;
      budget?: number;
    }>;
    expect(list.find((a) => a.id === "mcp")?.budget).toBe(5);
    // 선언이 없는 에이전트는 키 자체가 없다(비면 안 싣는다).
    expect(list.find((a) => a.id === "filesystem")).not.toHaveProperty("budget");

    // 숫자 선언이 부팅 코드에서 리듀서 채널이 된다 — `approval`이 `askFor`가 되는 것과 같은 자리.
    const mcpDef = agents.find((a) => a.id === "mcp");
    if (mcpDef === undefined) throw new Error("mcp 에이전트가 없다");
    expect(buildAgentGraph(mcpDef, true).getChannelNames()).toContain("budget");
  });

  it("빈 메시지는 thread가 있어도 거절된다", async () => {
    expect((await postTurn(studio, await start(), { message: "" })).status).toBe(400);
  });
});

describe.skipIf(!hasCli)("체크포인트 → 진짜 모델 (구독 자격증명)", () => {
  let closeMcp: () => Promise<void>;

  beforeAll(async () => {
    closeMcp = await connectMcpAgents();
  });
  afterAll(async () => {
    await closeMcp();
  });

  interface Reply {
    messages: Array<{ role: string; content: string }>;
    steps: Array<{ nodes: string[] }>;
    pending: Array<{ name: string }>;
    thread: { state: { budget?: number }; messages: unknown[] };
    error?: string;
  }
  const chat = async (id: string, input: unknown): Promise<Reply> =>
    (await (await postTurn(studio, id, input)).json()) as Reply;

  it("같은 thread의 예산은 누적되고 새 thread는 초기 예산으로 시작한다", async () => {
    const id = await start();
    const budgets: number[] = [];
    for (const text of ["서울 날씨", "부산은?"]) {
      const reply = await chat(id, { message: text });
      expect(reply.error).toBeUndefined();
      budgets.push(reply.thread.state.budget ?? Number.NaN);
    }
    expect(budgets).toEqual([4, 3]);
    const fresh = await chat(await start(), { message: "서울 날씨" });
    expect(fresh.thread.state.budget).toBe(4);
  }, 180_000);

  it("승인 재개는 결정만 보낸다 — 이력은 서버에서 복원한다", async () => {
    const id = await start();
    const paused = await chat(id, { message: "'장보기: 우유'라고 메모 저장해줘" });
    expect(paused.pending.map((c) => c.name)).toEqual(["write_note"]);
    const resumed = await chat(id, { decision: "allow" });
    expect(resumed.error).toBeUndefined();
    expect(resumed.steps[0]?.nodes).toEqual(["tools"]);
    expect(resumed.pending).toEqual([]);
    expect(resumed.messages.length).toBe(2);
    expect(resumed.thread.state.budget).toBe(3);
  }, 180_000);
});
