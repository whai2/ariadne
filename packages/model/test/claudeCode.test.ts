import { describe, expect, test } from "bun:test";
import {
  ai,
  END,
  human,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  system,
  tool,
} from "@ariadne/core";
import {
  buildArgs,
  ClaudeCodeError,
  claudeCodeChat,
  EmptyConversationError,
  model,
  PROVIDERS,
  parsePromptedToolCalls,
  parseResult,
  type RunCli,
  renderToolProtocol,
  type ToolSpec,
  ToolsUnsupportedError,
  toPrompt,
} from "../src/index";

/** `claude -p --output-format json`의 stdout을 흉내낸다(실제 응답 모양 그대로). */
const ok = (text: string) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: "sess_1",
    total_cost_usd: 0.0001,
  });

/** 프로세스를 띄우지 않고 인자·stdin을 관찰한다. */
function runner(stdout: string) {
  const calls: Array<{ args: string[]; input: string }> = [];
  const run: RunCli = async (args, input) => {
    calls.push({ args, input });
    return stdout;
  };
  return { calls, run };
}

describe("toPrompt — 대화를 한 덩어리로 직렬화", () => {
  test("턴이 하나면 라벨 없이 내용만", () => {
    expect(toPrompt([human("2+2는?")])).toEqual({ system: [], prompt: "2+2는?" });
  });

  test("여러 턴이면 역할 라벨을 붙여 펼친다", () => {
    expect(toPrompt([human("안녕"), ai("반가워요"), human("2+2는?")]).prompt).toBe(
      "Human: 안녕\n\nAssistant: 반가워요\n\nHuman: 2+2는?",
    );
  });

  test("system은 프롬프트에서 빠져 따로 모인다", () => {
    const { system: sys, prompt } = toPrompt([system("간결하게"), human("안녕")]);
    expect(sys).toEqual(["간결하게"]);
    expect(prompt).toBe("안녕");
  });

  test("툴 결과도 라벨을 붙여 편다 (부를 순 없어도 이력은 실어준다)", () => {
    expect(toPrompt([human("3+4는?"), ai(""), tool("call_1", "7")]).prompt).toBe(
      "Human: 3+4는?\n\nAssistant: \n\nTool result: 7",
    );
  });

  test("**단일 턴 지름길이 tool 결과를 안 집는다** — 역할이 늘며 생겼던 구멍(F2.1 회귀)", () => {
    // human이 없으므로 지름길을 타면 안 된다. 타면 라벨이 사라져 무슨 값인지 알 수 없다.
    expect(toPrompt([tool("call_1", "7")]).prompt).toBe("Tool result: 7");
  });
});

describe("buildArgs — 하네스를 걷어내는 인자", () => {
  test("툴을 **제거**한다 — 거부만 하면 정의가 컨텍스트에 남는다", () => {
    const args = buildArgs({});
    expect(args).toContain("-p");
    expect(args.join(" ")).toContain("--output-format json");

    // 여기가 핵심. --disallowed-tools는 실행만 막고 정의는 남긴다(측정: 10,093 토큰).
    // --tools "" 는 컨텍스트에서 뺀다(7,286 → system 프롬프트까지 주면 923).
    expect(args).toContain("--tools");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("--disallowed-tools");

    expect(args).toContain("--disable-slash-commands"); // 스킬
    expect(args).toContain("--strict-mcp-config"); // MCP
    expect(args).toContain("--no-session-persistence"); // 단발이라 세션 파일 불필요
  });

  test("**system 프롬프트는 항상 넘긴다** — 없으면 프리셋이 붙어 격리가 무너진다", () => {
    const bare = buildArgs({});
    expect(bare).toContain("--system-prompt");
    expect(bare[bare.indexOf("--system-prompt") + 1]).not.toBe("");

    const given = buildArgs({ system: "간결하게" });
    expect(given[given.indexOf("--system-prompt") + 1]).toBe("간결하게");
  });

  test("model은 있을 때만 붙는다", () => {
    expect(buildArgs({}).join(" ")).not.toContain("--model");
    expect(buildArgs({ model: "sonnet" }).join(" ")).toContain("--model sonnet");
  });
});

describe("parseResult — stdout(JSON)에서 텍스트를 꺼낸다", () => {
  test("성공", () => {
    expect(parseResult(ok("4"))).toBe("4");
  });

  test("실패 subtype·JSON 아님·result 없음을 각각 구분해 던진다", () => {
    expect(() => parseResult(JSON.stringify({ subtype: "error_max_turns" }))).toThrow(
      ClaudeCodeError,
    );
    expect(() => parseResult("not json")).toThrow(/JSON이 아니다/);
    expect(() => parseResult(JSON.stringify({ subtype: "success" }))).toThrow(/result 필드가 없다/);
  });
});

describe("claudeCodeChat", () => {
  test("프롬프트는 stdin으로, 설정은 인자로 간다", async () => {
    const { calls, run } = runner(ok("4입니다"));
    const result = await claudeCodeChat({ run, model: "opus" }).invoke([human("2+2는?")]);

    expect(result).toEqual({ role: "ai", content: "4입니다" });
    expect(calls[0]?.input).toBe("2+2는?"); // 인자가 아니라 stdin — 길이·이스케이프 걱정이 없다
    expect(calls[0]?.args.join(" ")).toContain("--model opus");
  });

  test("**id를 안 싣는다** — 세션 id를 쓰면 addMessages가 서로를 덮어쓴다", async () => {
    const { run } = runner(ok("응답"));
    const result = await claudeCodeChat({ run }).invoke([human("안녕")]);
    expect(result).not.toHaveProperty("id"); // V8의 "같은 id면 교체"에 걸리면 안 된다
  });

  test("시스템 지시는 systemPrompt로 합쳐 간다", async () => {
    const { calls, run } = runner(ok("ok"));
    await claudeCodeChat({ run, system: "모델 고정" }).invoke([system("대화 속"), human("안녕")], {
      system: "호출별",
    });
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("모델 고정\n\n호출별\n\n대화 속");
  });

  test("보낼 게 없으면 서브프로세스를 띄우기 전에 끊는다", async () => {
    const { calls, run } = runner(ok("ok"));
    const m = claudeCodeChat({ run });
    await expect(m.invoke([])).rejects.toThrow(EmptyConversationError);
    await expect(m.invoke([system("지시만")])).rejects.toThrow(EmptyConversationError);
    expect(calls).toEqual([]);
  });

  test("CLI가 실패를 알리면 그대로 던진다", async () => {
    const bad = runner(JSON.stringify({ subtype: "error_during_execution", is_error: true }));
    await expect(claudeCodeChat({ run: bad.run }).invoke([human("x")])).rejects.toThrow(
      ClaudeCodeError,
    );
  });

  test("**supportsTools는 기본 false, promptedTools를 켜면 true**", () => {
    expect(claudeCodeChat({ run: runner(ok("x")).run }).supportsTools).toBe(false);
    expect(claudeCodeChat({ run: runner(ok("x")).run, promptedTools: true }).supportsTools).toBe(
      true,
    );
  });

  test("**tools를 주면 던진다(심이 꺼져 있을 때) — 조용히 무시하지 않는다**", async () => {
    const { calls, run } = runner(ok("ok"));
    await expect(
      claudeCodeChat({ run }).invoke([human("3+4는?")], {
        tools: [{ name: "add", parameters: { type: "object", properties: {} } }],
      }),
    ).rejects.toThrow(ToolsUnsupportedError);
    // 무시했다면 산문 답변이 돌아와 그래프가 영영 툴 노드로 안 간다.
    expect(calls).toEqual([]);
  });

  test("빈 tools 배열은 툴을 안 쓰는 것이므로 통과시킨다", async () => {
    const { run } = runner(ok("ok"));
    const result = await claudeCodeChat({ run }).invoke([human("안녕")], { tools: [] });
    expect(result.content).toBe("ok");
  });

  test("그래프에 꽂으면 다른 두 어댑터와 **똑같이** 동작한다", async () => {
    const { run } = runner(ok("4입니다"));
    const m = claudeCodeChat({ run });

    const g = new StateGraph<MessagesState>(messagesSchema);
    g.addNode("model", async (s) => ({ messages: [await m.invoke(s.messages)] }));
    g.addEdge(START, "model");
    g.addEdge("model", END);

    expect((await g.compile().invoke({ messages: [human("2+2는?")] })).messages).toEqual([
      { role: "human", content: "2+2는?" },
      { role: "ai", content: "4입니다" },
    ]);
  });
});

// ─── 길 B · 프롬프트 기반 툴 호출 심 (F2.4) ──────────────────────────────────────
const ADD_SPEC: ToolSpec = {
  name: "add",
  description: "두 수를 더한다",
  parameters: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
};

describe("renderToolProtocol — 툴 선언을 프롬프트 텍스트로", () => {
  test("이름·설명·JSON Schema·호출 규약이 다 실린다", () => {
    const text = renderToolProtocol([ADD_SPEC]);
    expect(text).toContain("add");
    expect(text).toContain("두 수를 더한다");
    expect(text).toContain('"type":"number"'); // 파라미터 스키마가 그대로
    expect(text).toContain("tool_calls"); // 모델이 뱉을 형식
  });
});

describe("parsePromptedToolCalls — 모델 텍스트를 toolCalls로 되살린다", () => {
  test("깔끔한 JSON 하나 → toolCall 하나(id는 우리가 붙인다), content는 빈다", () => {
    const r = parsePromptedToolCalls('{"tool_calls":[{"name":"add","arguments":{"a":3,"b":4}}]}');
    expect(r.toolCalls).toEqual([{ id: "call_1", name: "add", args: { a: 3, b: 4 } }]);
    expect(r.content).toBe("");
  });

  test("한 번에 툴 둘 → id가 순서대로 call_1, call_2", () => {
    const r = parsePromptedToolCalls(
      '{"tool_calls":[{"name":"add","arguments":{"a":1,"b":2}},{"name":"multiply","arguments":{"a":3,"b":4}}]}',
    );
    expect(r.toolCalls.map((c) => [c.id, c.name])).toEqual([
      ["call_1", "add"],
      ["call_2", "multiply"],
    ]);
  });

  test("```json``` 코드펜스로 감싸도 벗겨서 읽는다(모델이 규약을 자주 어긴다)", () => {
    const r = parsePromptedToolCalls(
      '```json\n{"tool_calls":[{"name":"add","arguments":{}}]}\n```',
    );
    expect(r.toolCalls).toEqual([{ id: "call_1", name: "add", args: {} }]);
  });

  test("툴 호출이 없으면 텍스트 전체가 최종 답(prose)", () => {
    const r = parsePromptedToolCalls("답은 7입니다.");
    expect(r.toolCalls).toEqual([]);
    expect(r.content).toBe("답은 7입니다.");
  });

  test("arguments가 문자열이면 파싱하고, 깨졌으면 invalidArgs로 원문 보존(OpenAI 비대칭과 같은 처리)", () => {
    const good = parsePromptedToolCalls(
      '{"tool_calls":[{"name":"add","arguments":"{\\"a\\":3}"}]}',
    );
    expect(good.toolCalls[0]).toEqual({ id: "call_1", name: "add", args: { a: 3 } });

    const broken = parsePromptedToolCalls('{"tool_calls":[{"name":"add","arguments":"{a:3"}]}');
    expect(broken.toolCalls[0]).toEqual({
      id: "call_1",
      name: "add",
      args: {},
      invalidArgs: "{a:3",
    });
  });
});

describe("claudeCodeChat + promptedTools (길 B 왕복)", () => {
  /** 턴마다 다음 stdout을 돌려주는 실행자. 왕복을 결정론적으로 관찰한다. */
  function scriptedRunner(outputs: string[]) {
    const calls: Array<{ args: string[]; input: string }> = [];
    let i = 0;
    const run: RunCli = async (args, input) => {
      calls.push({ args, input });
      const out = outputs[Math.min(i, outputs.length - 1)] ?? ok("");
      i += 1;
      return out;
    };
    return { calls, run };
  }

  test("텍스트로 툴을 부르고, 결과를 되먹이면 최종 답을 낸다 — 툴 루프가 우리 쪽에 남는다", async () => {
    const { calls, run } = scriptedRunner([
      ok('{"tool_calls":[{"name":"add","arguments":{"a":3,"b":4}}]}'),
      ok("답은 7입니다."),
    ]);
    const m = claudeCodeChat({ run, promptedTools: true });

    // 1턴: 모델이 텍스트로 add를 부른다 → toolCalls로 되살아난다.
    const first = await m.invoke([human("3+4는?")], { tools: [ADD_SPEC] });
    expect(first.toolCalls).toEqual([{ id: "call_1", name: "add", args: { a: 3, b: 4 } }]);
    expect(first.content).toBe("");
    // 시스템 프롬프트에 툴 규약이 실렸다.
    const sys = calls[0]?.args[(calls[0]?.args.indexOf("--system-prompt") ?? -1) + 1] ?? "";
    expect(sys).toContain("tool_calls");
    expect(sys).toContain("add");

    // 2턴: toolNode 역할을 우리가 대신 — 결과를 이력에 붙여 되먹인다.
    const second = await m.invoke([human("3+4는?"), first, tool("call_1", "7")], {
      tools: [ADD_SPEC],
    });
    expect(second.toolCalls).toBeUndefined(); // 산문 답 → toolsCondition이 END를 고른다
    expect(second.content).toBe("답은 7입니다.");
    // 되먹인 프롬프트에 어시스턴트의 이전 호출과 툴 결과가 보인다(모델이 자기 행동을 본다).
    expect(calls[1]?.input).toContain("add");
    expect(calls[1]?.input).toContain("Tool result: 7");
  });

  test("모델이 산문으로 답하면 toolCalls 없이 그대로 통과(툴 안 씀)", async () => {
    const { run } = scriptedRunner([ok("툴 없이 바로 답합니다.")]);
    const r = await claudeCodeChat({ run, promptedTools: true }).invoke([human("안녕")], {
      tools: [ADD_SPEC],
    });
    expect(r.toolCalls).toBeUndefined();
    expect(r.content).toBe("툴 없이 바로 답합니다.");
  });
});

describe("toPrompt — 어시스턴트의 이전 툴 호출을 이력에 되살린다", () => {
  test("toolCalls를 든 ai 메시지는 규약 JSON으로 펴진다(빈 content로 사라지지 않게)", () => {
    const { prompt } = toPrompt([
      human("3+4는?"),
      ai("", undefined, [{ id: "call_1", name: "add", args: { a: 3, b: 4 } }]),
      tool("call_1", "7"),
    ]);
    expect(prompt).toContain(
      'Assistant: {"tool_calls":[{"name":"add","arguments":{"a":3,"b":4}}]}',
    );
    expect(prompt).toContain("Tool result: 7");
  });
});

describe("라우터에서 고르기", () => {
  test("claude-code는 API 키도 baseURL도 요구하지 않는다", () => {
    // 자격증명은 claude 바이너리가 자기 것을 쓴다 — 우리가 만지지 않는다.
    expect(PROVIDERS["claude-code"]?.format).toBe("claudeCode");
    expect(PROVIDERS["claude-code"]?.env).toEqual([]);

    const m = model("claude-code/opus", { env: {} }); // 키 하나도 없는 환경
    expect(m.provider).toBe("claude-code");
    expect(m.modelId).toBe("opus");
  });
});

// 실제 `claude` 호출. 바이너리가 있고 로그인돼 있을 때만 돈다.
// **API 키가 필요 없다** — 이 경로의 핵심이 그거다.
const hasCli = Bun.spawnSync(["which", "claude"]).exitCode === 0;
describe.skipIf(!hasCli)("실제 Claude Code 호출 (구독 자격증명)", () => {
  test("키 하나 없이 그래프가 진짜 모델로 돈다", async () => {
    const g = new StateGraph<MessagesState>(messagesSchema);
    const m = model("claude-code/sonnet", { system: "숫자만 답해라." });
    g.addNode("model", async (s) => ({ messages: [await m.invoke(s.messages)] }));
    g.addEdge(START, "model");
    g.addEdge("model", END);

    const out = await g.compile().invoke({ messages: [human("2+2는?")] });
    expect(out.messages).toHaveLength(2);
    expect(out.messages[1]?.role).toBe("ai");
    expect(out.messages[1]?.content).toContain("4");
  }, 120_000);
});
