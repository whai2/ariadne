// Claude Code 어댑터 — **트랜스포트가 다른** 세 번째 어댑터.
//
// 앞의 둘은 와이어 포맷이 달랐다(Anthropic vs OpenAI). 이건 **HTTP를 아예 안 탄다.**
//
//   anthropic.ts         HTTPS → api.anthropic.com     API 키
//   openaiCompatible.ts  HTTPS → {baseURL}/chat/...    API 키
//   claudeCode.ts        서브프로세스 → `claude` 바이너리  ← CLI가 자기 자격증명을 쓴다
//
// 그래서 **API 키가 없어도 된다.** Claude Code에 로그인돼 있으면 그 자격증명으로 돈다.
// 우리는 자격증명을 만지지 않는다 — 프로세스를 띄울 뿐이다.
//
// **의존성 0.** 처음엔 `@anthropic-ai/claude-agent-sdk`를 쓰려 했는데, 그 패키지는
// 플랫폼 네이티브 바이너리를 딸고 와서 220MB다. 확인해보니 CLI의 print 모드가
// 우리가 필요한 걸 그대로 준다 — `claude -p --output-format json`이 result 객체 하나를
// 내놓는다. SDK는 이걸 감싼 것이므로, 단발 텍스트 왕복엔 spawn으로 충분하다.
// (세션·툴·승인 게이트를 살리려면 그때 SDK가 필요해진다 → F3)

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import {
  type AIMessage,
  ai,
  type BaseMessage,
  isAIMessage,
  isToolMessage,
  type ToolCall,
} from "@ariadne/core";
import { ClaudeCodeError, EmptyConversationError, ToolsUnsupportedError } from "./errors";
import type { ChatModel, ChatOptions, ToolSpec } from "./types";

/** `claude -p --output-format json`이 내놓는 result 객체 중 우리가 보는 것만. */
export interface ClaudeCodeResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  session_id?: string;
}

/**
 * 이 어댑터가 쓰는 **유일한 능력**: 인자를 주면 stdout을 돌려주는 것.
 * 실제로는 `claude`를 spawn하고, 테스트는 가짜를 꽂는다(프로세스 없이 검증).
 */
export type RunCli = (args: string[], input: string, signal?: AbortSignal) => Promise<string>;

/**
 * 하네스를 걷어내는 인자들. **측정으로 고른 것이다**(프롬프트 토큰, 캐시 워밍 후 2회차):
 *
 * ```
 * 기본                                    18,040
 * --disallowed-tools ...                 10,093   ← 거부만 하지 제거는 안 한다
 * --tools ""                              7,286   ← 툴 정의를 컨텍스트에서 뺀다
 *   + --disable-slash-commands            7,286
 *   + --system-prompt                       923   ← 프리셋 대체가 여기서 비로소 효과
 * ```
 *
 * `--disallowed-tools`로는 안 된다는 게 핵심이다 — 그건 실행을 막을 뿐 정의는 남는다.
 * `--bare`가 더 강하지만 **구독 자격증명을 안 읽는다**(`Not logged in`)이라 못 쓴다.
 */
const ISOLATION = [
  "--tools",
  "", // 내장 툴을 컨텍스트에서 **제거**한다(거부가 아니라)
  "--disable-slash-commands", // 스킬 비활성
  "--strict-mcp-config", // --mcp-config가 없으므로 MCP를 하나도 안 붙인다
  "--no-session-persistence", // 단발 호출이라 세션 파일을 남길 이유가 없다
];

/**
 * 시스템 프롬프트를 안 줬을 때 쓰는 기본값.
 *
 * **빈 값으로 두면 안 된다.** `--system-prompt`가 없으면 Claude Code의 코딩 어시스턴트
 * 프리셋이 그대로 붙어(위 표의 7,286) 지시가 그 안에 묻힌다.
 */
const NEUTRAL_SYSTEM = "You are a helpful assistant. Answer the user directly.";

export interface ClaudeCodeConfig {
  /** 모델 별칭(`opus`·`sonnet`) 또는 전체 ID. 생략하면 CLI 기본값. */
  model?: string;
  /** 이 모델에 항상 붙는 시스템 지시. */
  system?: string;
  /** `claude` 실행 파일 경로. 기본은 PATH의 `claude`. */
  executable?: string;
  /**
   * 작업 디렉터리. **기본은 임시 디렉터리다(중요).**
   *
   * `claude`는 실행된 디렉터리에서 `CLAUDE.md`·스킬·플러그인을 자동으로 읽는다.
   * 저장소 안에서 띄우면 그 맥락이 통째로 프롬프트에 실려, 우리가 준 system 지시를
   * 덮어버린다. 실측: 같은 질문에 저장소에서는 지시를 무시한 산문 16.9초,
   * 임시 디렉터리에서는 지시대로 JSON 6.0초.
   *
   * ChatModel은 "텍스트 한 번 주고받기"라 저장소 맥락이 필요 없다 — 오염일 뿐이다.
   * 저장소 맥락을 **일부러** 쓰고 싶으면 명시적으로 넘겨라.
   */
  cwd?: string;
  /** 관찰용 라벨. */
  provider?: string;
  /**
   * 툴을 **프롬프트로 흉내** 낸다 (길 B). **기본은 꺼짐** → tools를 주면 던지던 동작 그대로.
   *
   * 켜면 `options.tools`를 시스템 프롬프트에 텍스트로 풀어 넣고(→ `renderToolProtocol`),
   * 모델이 뱉은 텍스트를 파싱해 `toolCalls`로 되살린다(→ `parsePromptedToolCalls`).
   * 와이어는 여전히 텍스트 한 왕복이지만 **툴 루프는 우리 그래프 안에 남는다** — 그게
   * MCP(=claude-code가 자기 루프에서 실행)와 갈리는 지점이고, "스텝 가시화 + 워크플로우
   * 제어"를 지키는 유일한 길이다.
   */
  promptedTools?: boolean;
  /** 실행 함수 주입점(테스트용). */
  run?: RunCli;
}

/**
 * 대화를 **한 덩어리 프롬프트로 직렬화**한다.
 *
 * print 모드는 문자열 하나를 받는다. `ChatModel.invoke`는 단발이라 세션을 유지할 수
 * 없으므로 이력을 역할 라벨과 함께 펼쳐 넣는다.
 *
 * **손실이 있다.** 모델이 보는 건 진짜 대화 구조가 아니라 "대화를 적어놓은 텍스트"다.
 * 진짜 멀티턴은 세션(`--resume`)이나 stream-json 입력이 필요하고, 그건 `ChatModel`보다
 * 큰 인터페이스를 요구한다(F3).
 */
export function toPrompt(messages: BaseMessage[]): { system: string[]; prompt: string } {
  const system: string[] = [];
  const turns: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system") system.push(msg.content);
    else if (isAIMessage(msg)) {
      // 프롬프트 툴 모드(길 B)에선 어시스턴트 메시지가 content 대신 toolCalls를 들 수 있다.
      // 그걸 규약과 **같은 JSON**으로 되살려 이력에 넣는다 — 안 그러면 다음 턴에 모델이
      // 자기가 방금 무슨 툴을 불렀는지 못 봐서 되풀이하거나 헤맨다. (네이티브 모드엔
      // claude-code가 toolCalls를 만들 일이 없으니 이 가지는 프롬프트 모드에서만 탄다.)
      const calls = msg.toolCalls;
      turns.push(
        calls !== undefined && calls.length > 0
          ? `Assistant: ${renderAssistantCalls(calls)}`
          : `Assistant: ${msg.content}`,
      );
    }
    // 툴 결과도 실어준다 — 이미 대화를 텍스트로 펴고 있으니 손실의 성질이 같다.
    else if (isToolMessage(msg)) turns.push(`Tool result: ${msg.content}`);
    else turns.push(`Human: ${msg.content}`);
  }
  // 턴이 하나뿐이면 라벨이 잡음이다 — 그냥 그 내용만 보낸다.
  // **human만 이 지름길을 탄다**: 역할이 늘면서 `role !== "system"`이 tool 결과를
  // "유일한 턴"으로 집는 구멍이 생겼다(그러면 라벨이 사라져 무슨 값인지 알 수 없게 된다).
  const only = messages.find((m) => m.role === "human");
  const prompt = turns.length === 1 && only !== undefined ? only.content : turns.join("\n\n");
  return { system, prompt };
}

// ─── 길 B · 프롬프트 기반 툴 호출 심 ─────────────────────────────────────────────
//
// claude-code의 와이어엔 툴을 실을 자리가 없다(그래서 기본은 던진다). 하지만 우리
// 아키텍처의 핵심이 "각 스텝 가시화 + 워크플로우 제어"라면, 툴 루프는 **우리 그래프
// 안에** 있어야 한다 — MCP처럼 claude-code 내부 루프로 넘기면 스텝이 안 보이고 제어도
// 놓친다. 그래서 네이티브 tool_use API가 없던 시절의 방식을 쓴다: 툴을 **말로 설명**하고,
// 모델이 뱉은 **텍스트를 파싱**해 우리 어휘(toolCalls)로 되살린다. 그러면 toolsCondition·
// toolNode·엔진이 그대로 돈다 — 실행도 라우팅도 우리가 한다.
//
// 대가(정직): id를 우리가 만들고(프로바이더가 안 주므로), 와이어 스키마 강제가 없다
// (zod가 toolNode에서 사후 검증한다). 네이티브보다 덜 튼튼하다.

/**
 * 툴 선언을 **시스템 프롬프트 텍스트**로 편다 (심의 입력 절반). **순수 함수.**
 *
 * `options.tools`(모델 링의 `ToolSpec`)를 그대로 받는다 — 툴 링을 import하지 않는다.
 */
export function renderToolProtocol(tools: ToolSpec[]): string {
  const list = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description ?? ""}\n  parameters(JSON Schema): ${JSON.stringify(t.parameters)}`,
    )
    .join("\n");
  return [
    "# 사용할 수 있는 툴",
    list,
    "",
    "# 툴 호출 규약",
    "툴이 필요하면 **오직 아래 JSON 하나만** 출력하고 다른 말·마크다운은 붙이지 마라:",
    '{"tool_calls":[{"name":"<툴 이름>","arguments":{ ... }}]}',
    "- 여러 툴을 한 번에 부르려면 배열에 항목을 더 넣어라.",
    "- 툴이 더 필요 없고 최종 답을 낼 때는 평범한 텍스트로 답하라.",
  ].join("\n");
}

/** ```json …``` / ```…``` 코드펜스를 벗긴다 — 모델이 규약을 어기고 습관적으로 감싼다. */
function stripFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence?.[1] ?? text;
}

/**
 * 텍스트에서 `tool_calls` 배열을 꺼낸다. 없으면 빈 배열.
 * 통째 파싱을 먼저 하고, 실패하면 가장 바깥 `{…}`만 긁어 재시도한다(앞뒤에 잡담이 붙은 경우).
 */
function extractToolCallEntries(text: string): unknown[] {
  for (const candidate of [text, text.match(/\{[\s\S]*\}/)?.[0]]) {
    if (candidate === undefined) continue;
    try {
      const obj = JSON.parse(candidate) as { tool_calls?: unknown };
      if (Array.isArray(obj.tool_calls)) return obj.tool_calls;
    } catch {
      // 다음 후보로
    }
  }
  return [];
}

/**
 * 모델이 뱉은 텍스트 → `{ content, toolCalls }` (심의 출력 절반). **순수 함수.**
 *
 * `{"tool_calls":[…]}`를 찾으면 되살리고(content는 비운다 — 네이티브 툴 호출 메시지와 같게),
 * 못 찾으면 텍스트 전체가 최종 답이다. id는 프로바이더가 안 주므로 우리가 붙인다(`call_1`…).
 * 인자가 깨진 JSON 문자열이면 `invalidArgs`로 원문을 보존한다(OpenAI 비대칭과 같은 처리 —
 * toolNode가 "필수 인자 누락"으로 오진하지 않게).
 */
export function parsePromptedToolCalls(text: string): { content: string; toolCalls: ToolCall[] } {
  const stripped = stripFence(text).trim();
  const toolCalls: ToolCall[] = [];
  extractToolCallEntries(stripped).forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) return;
    const name = (entry as Record<string, unknown>).name;
    if (typeof name !== "string") return;
    const id = `call_${i + 1}`;
    const raw = (entry as Record<string, unknown>).arguments;
    if (raw === undefined || raw === null) {
      toolCalls.push({ id, name, args: {} });
    } else if (typeof raw === "string") {
      // 모델이 arguments를 문자열로 싼 경우 — 파싱해보고, 깨졌으면 원문 보존.
      try {
        toolCalls.push({ id, name, args: JSON.parse(raw) as Record<string, unknown> });
      } catch {
        toolCalls.push({ id, name, args: {}, invalidArgs: raw });
      }
    } else if (typeof raw === "object") {
      toolCalls.push({ id, name, args: raw as Record<string, unknown> });
    } else {
      toolCalls.push({ id, name, args: {}, invalidArgs: String(raw) });
    }
  });
  return toolCalls.length > 0 ? { content: "", toolCalls } : { content: stripped, toolCalls: [] };
}

/** 이력용: 어시스턴트의 이전 툴 호출을 규약과 같은 JSON으로 되살린다(toPrompt에서 쓴다). */
function renderAssistantCalls(calls: ToolCall[]): string {
  return JSON.stringify({ tool_calls: calls.map((c) => ({ name: c.name, arguments: c.args })) });
}

/** CLI 인자를 만든다. **순수 함수** — 무엇을 보내는지 테스트로 관찰한다. */
export function buildArgs(opts: { model?: string; system?: string }): string[] {
  return [
    "-p", // print 모드: 한 번 답하고 종료
    "--output-format",
    "json", // result 객체 하나
    ...ISOLATION,
    ...(opts.model === undefined ? [] : ["--model", opts.model]),
    // **항상** 넘긴다 — 없으면 프리셋이 붙어 격리가 무너진다.
    "--system-prompt",
    opts.system ?? NEUTRAL_SYSTEM,
  ];
}

/** stdout(JSON)에서 최종 텍스트를 꺼낸다. 실패는 이유를 담아 던진다. */
export function parseResult(stdout: string): string {
  let parsed: ClaudeCodeResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeCodeResult;
  } catch {
    throw new ClaudeCodeError(`출력이 JSON이 아니다: ${stdout.slice(0, 200)}`);
  }
  if (parsed.is_error === true || parsed.subtype !== "success") {
    throw new ClaudeCodeError(`실패 (${parsed.subtype ?? "unknown"})`);
  }
  if (typeof parsed.result !== "string") {
    throw new ClaudeCodeError("result 필드가 없다");
  }
  return parsed.result;
}

/** 기본 실행자 — `claude`를 spawn하고 stdout을 모은다. 프롬프트는 stdin으로 넣는다. */
function spawnCli(executable: string, cwd?: string): RunCli {
  return (args, input, signal) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(executable, args, {
        ...(cwd === undefined ? {} : { cwd }),
        stdio: ["pipe", "pipe", "pipe"],
        ...(signal === undefined ? {} : { signal }),
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (c: Buffer) => {
        out += c.toString();
      });
      child.stderr.on("data", (c: Buffer) => {
        err += c.toString();
      });
      child.on("error", (e) =>
        reject(
          new ClaudeCodeError(
            `\`${executable}\` 실행 실패 — Claude Code가 설치돼 있고 로그인돼 있어야 한다 (${e.message})`,
          ),
        ),
      );
      child.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new ClaudeCodeError(`종료 코드 ${code}: ${err.trim()}`)),
      );
      child.stdin.end(input);
    });
}

/**
 * Claude Code를 `ChatModel`로 감싼다.
 *
 * ```ts
 * const m = claudeCodeChat({ model: "sonnet" });
 * g.addNode("model", async (s) => ({ messages: [await m.invoke(s.messages)] }));
 * ```
 *
 * 에이전트 하네스를 **단발 텍스트 왕복으로 좁혀** 쓴다 — 내장 툴 전면 차단, print 모드.
 * 툴·세션·승인 게이트를 살리고 싶다면 이 인터페이스로는 부족하다(→ F3 에이전트 링).
 */
export function claudeCodeChat(config: ClaudeCodeConfig = {}): ChatModel {
  const run = config.run ?? spawnCli(config.executable ?? "claude", config.cwd ?? tmpdir());

  const provider = config.provider ?? "claude-code";

  const promptedTools = config.promptedTools === true;

  return {
    provider,
    modelId: config.model ?? "default",
    // **와이어엔 자리가 없다** — `-p`는 result 문자열 하나뿐. 그래서 기본은 못 싣는다.
    // 단 `promptedTools`를 켜면 프롬프트로 흉내 낼 수 있다(길 B) → 그땐 실을 자리가 생긴 셈.
    supportsTools: promptedTools,

    async invoke(messages: BaseMessage[], options: ChatOptions = {}): Promise<AIMessage> {
      const wantsTools = options.tools !== undefined && options.tools.length > 0;
      // 프롬프트 심이 꺼져 있으면 조용히 무시하지 않고 던진다 — 무시하면 모델이 산문으로
      // 답하고 그래프가 영영 툴 노드로 안 간다.
      if (wantsTools && !promptedTools) throw new ToolsUnsupportedError(provider);

      const { system: convSystem, prompt } = toPrompt(messages);
      if (prompt === "") throw new EmptyConversationError();

      const system = [
        config.system,
        options.system,
        ...convSystem,
        // 툴 규약은 **마지막에** 붙인다 — 사용자 지시 뒤에 와야 규약이 덜 묻힌다.
        ...(wantsTools ? [renderToolProtocol(options.tools ?? [])] : []),
      ]
        .filter((s): s is string => s !== undefined && s !== "")
        .join("\n\n");

      const args = buildArgs({
        ...(config.model === undefined ? {} : { model: config.model }),
        ...(system === "" ? {} : { system }),
      });

      const out = parseResult(await run(args, prompt, options.signal));

      // 세션 id를 메시지 id로 쓰지 않는다 — 여러 턴이 같은 세션이면 addMessages가
      // 서로를 덮어쓴다(V8의 "같은 id면 교체"). id 없이 두면 항상 append다.
      if (!wantsTools) return ai(out);
      // 툴을 실었으면 텍스트를 toolCalls로 되살린다 — 없으면 그냥 최종 답(prose)이다.
      const { content, toolCalls } = parsePromptedToolCalls(out);
      return ai(content, undefined, toolCalls);
    },
  };
}
