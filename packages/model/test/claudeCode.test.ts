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
} from "@ariadne/core";
import {
  buildArgs,
  ClaudeCodeError,
  claudeCodeChat,
  EmptyConversationError,
  model,
  PROVIDERS,
  parseResult,
  type RunCli,
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
