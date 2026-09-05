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
import { type AIMessage, ai, type BaseMessage } from "@ariadne/core";
import { ClaudeCodeError, EmptyConversationError } from "./errors";
import type { ChatModel, ChatOptions } from "./types";

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
    else if (msg.role === "ai") turns.push(`Assistant: ${msg.content}`);
    else turns.push(`Human: ${msg.content}`);
  }
  // 턴이 하나뿐이면 라벨이 잡음이다 — 그냥 그 내용만 보낸다.
  const only = messages.find((m) => m.role !== "system");
  const prompt = turns.length === 1 ? (only?.content ?? "") : turns.join("\n\n");
  return { system, prompt };
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

  return {
    provider: config.provider ?? "claude-code",
    modelId: config.model ?? "default",

    async invoke(messages: BaseMessage[], options: ChatOptions = {}): Promise<AIMessage> {
      const { system: convSystem, prompt } = toPrompt(messages);
      if (prompt === "") throw new EmptyConversationError();

      const system = [config.system, options.system, ...convSystem]
        .filter((s): s is string => s !== undefined && s !== "")
        .join("\n\n");

      const args = buildArgs({
        ...(config.model === undefined ? {} : { model: config.model }),
        ...(system === "" ? {} : { system }),
      });

      // 세션 id를 메시지 id로 쓰지 않는다 — 여러 턴이 같은 세션이면 addMessages가
      // 서로를 덮어쓴다(V8의 "같은 id면 교체"). id 없이 두면 항상 append다.
      return ai(parseResult(await run(args, prompt, options.signal)));
    },
  };
}
