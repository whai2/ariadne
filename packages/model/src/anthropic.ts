// Anthropic 어댑터 — 중립 `ChatModel`을 Claude Messages API 위에 구현한다.
//
// 하는 일은 두 방향의 번역뿐:
//   core BaseMessage[]  →  Anthropic 와이어 포맷   (toAnthropicMessages)
//   Anthropic Message   →  core AIMessage          (invoke 끝부분)
//
// **Anthropic 전용이 아니라 "Anthropic 와이어 포맷" 어댑터다.** MiniMax·Kimi 등도
// 같은 포맷의 엔드포인트를 내므로, `baseURL`만 바꾸면 그대로 쓰인다(→ registry.ts).

import Anthropic from "@anthropic-ai/sdk";
import {
  type AIMessage,
  ai,
  type BaseMessage,
  isAIMessage,
  isToolMessage,
  type ToolCall,
} from "@ariadne/core";
import { EmptyConversationError, ModelRefusalError } from "./errors";
import type { ChatModel, ChatOptions, ToolSpec } from "./types";

/** 기본 모델. */
const DEFAULT_MODEL = "claude-opus-5";
/** 기본 응답 상한. 비스트리밍 요청이 HTTP 타임아웃에 걸리지 않는 선. */
const DEFAULT_MAX_TOKENS = 16_000;

/**
 * 이 어댑터가 실제로 쓰는 **유일한 능력**. 진짜 SDK 클라이언트도, 테스트 가짜도 이걸 만족한다.
 * 클래스 전체가 아니라 이 함수 하나만 의존하므로 테스트에 캐스팅이 필요 없다.
 */
export type CreateMessage = (
  body: Anthropic.MessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => Promise<Anthropic.Message>;

export interface AnthropicChatConfig {
  /** 모델 ID. 기본 `claude-opus-5`. */
  model?: string;
  /** API 키. 생략하면 SDK가 환경(ANTHROPIC_API_KEY 등)에서 찾는다. */
  apiKey?: string;
  /** 베이스 URL. 같은 포맷을 내는 다른 프로바이더(MiniMax·Kimi…)를 가리킬 때 쓴다. */
  baseURL?: string;
  /** 관찰용 라벨. 라우터가 실제 프로바이더 id를 넣어준다. */
  provider?: string;
  /** 응답 최대 토큰 기본값. 호출마다 `ChatOptions.maxTokens`로 덮을 수 있다. */
  maxTokens?: number;
  /** 이 모델에 항상 붙는 시스템 지시. 호출별 system·system 메시지와 합쳐진다. */
  system?: string;
  /** 호출 함수 주입점(테스트용). 없으면 공식 SDK 클라이언트를 만든다. */
  create?: CreateMessage;
}

/**
 * core 메시지 → Anthropic 와이어 포맷. **순수 함수** — 네트워크도 상태도 없다.
 *
 * F1은 "번역이 필요한 지점이 정확히 둘"이라고 적었다. F2에서 **셋째가 생겼다.**
 * 1. **역할 이름이 다르다.** human → user, ai → assistant.
 * 2. **system의 위치가 다르다.** core에선 대화 리스트 안의 한 메시지지만,
 *    Anthropic에선 대화와 **분리된 최상위 파라미터**다. 그래서 뽑아내야 한다.
 * 3. **툴 결과의 묶음 단위가 다르다.** 우리는 "결과 1개 = 메시지 1개"인데 Anthropic은
 *    한 턴의 결과 전부를 **user 메시지 하나의 블록들**로 받는다. 그래서 연속한 tool
 *    메시지 런을 접어야 한다 — 이 함수가 처음으로 **메시지 개수를 바꾼다.**
 *
 * 같은 역할이 연달아 와도 그대로 둔다 — API가 알아서 한 턴으로 합친다.
 */
export function toAnthropicMessages(messages: BaseMessage[]): {
  system: string[];
  messages: Anthropic.MessageParam[];
} {
  const system: string[] = [];
  const converted: Anthropic.MessageParam[] = [];
  // 연속한 tool 메시지를 모았다가 user 메시지 하나로 낸다.
  let results: Anthropic.ToolResultBlockParam[] = [];
  const flushResults = () => {
    if (results.length === 0) return;
    converted.push({ role: "user", content: results });
    results = [];
  };

  for (const msg of messages) {
    // system은 대화에서 통째로 빠지므로 런을 끊지 않는다(있으나 없으나 같아야 한다).
    if (msg.role === "system") {
      system.push(msg.content);
      continue;
    }
    if (isToolMessage(msg)) {
      results.push({
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
        ...(msg.status === "error" ? { is_error: true } : {}),
      });
      continue;
    }
    flushResults();
    if (isAIMessage(msg) && msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
      // content가 빈 문자열이면 text 블록을 **안 만든다** — 빈 text 블록은 400이다.
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.content !== "") blocks.push({ type: "text", text: msg.content });
      for (const call of msg.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
      }
      converted.push({ role: "assistant", content: blocks });
      continue;
    }
    converted.push({ role: msg.role === "human" ? "user" : "assistant", content: msg.content });
  }
  flushResults();
  return { system, messages: converted };
}

/** 응답의 text 블록만 이어붙인다. (thinking 등 다른 블록은 이 단계에선 버린다.) */
export function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * 응답의 tool_use 블록 → 중립 `ToolCall[]`. **F1까지 `extractText`가 버리던 것이다.**
 *
 * `input`이 이미 파싱된 객체라 여기선 할 일이 없다 — OpenAI 쪽에서 문자열을 파싱하는
 * 것과 대조된다(비대칭은 각 어댑터가 자기 안에서 흡수한다).
 */
export function extractToolCalls(message: Anthropic.Message): ToolCall[] {
  return message.content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      args: (block.input ?? {}) as Record<string, unknown>,
    }));
}

/** 중립 툴 선언 → Anthropic `tools`. 이름만 다르고(`parameters` → `input_schema`) 모양은 같다. */
export function toAnthropicTools(specs: ToolSpec[]): Anthropic.ToolUnion[] {
  return specs.map((spec) => ({
    name: spec.name,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    input_schema: spec.parameters,
  }));
}

/**
 * Anthropic 채팅 모델을 만든다.
 *
 * ```ts
 * const model = anthropicChat();
 * g.addNode("model", async (s) => ({ messages: [await model.invoke(s.messages)] }));
 * ```
 *
 * 사고(thinking)를 켜는 파라미터를 안 보내는 건 의도적이다 — `claude-opus-5`는
 * 생략하면 적응형 사고가 **기본으로 켜진다**.
 */
export function anthropicChat(config: AnthropicChatConfig = {}): ChatModel {
  const modelId = config.model ?? DEFAULT_MODEL;
  const defaultMaxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const create: CreateMessage =
    config.create ??
    ((body, options) => {
      const client = new Anthropic({
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
      });
      return client.messages.create(body, options);
    });

  return {
    provider: config.provider ?? "anthropic",
    modelId,
    supportsTools: true,

    async invoke(messages: BaseMessage[], options: ChatOptions = {}): Promise<AIMessage> {
      const converted = toAnthropicMessages(messages);
      if (converted.messages.length === 0) {
        throw new EmptyConversationError();
      }

      // 시스템 지시 세 출처(모델 고정 → 호출별 → 대화 속 system 메시지)를 순서대로 합친다.
      const system = [config.system, options.system, ...converted.system]
        .filter((s): s is string => s !== undefined && s !== "")
        .join("\n\n");

      const response = await create(
        {
          model: modelId,
          max_tokens: options.maxTokens ?? defaultMaxTokens,
          messages: converted.messages,
          ...(system === "" ? {} : { system }),
          ...(options.tools === undefined || options.tools.length === 0
            ? {}
            : { tools: toAnthropicTools(options.tools) }),
        },
        options.signal === undefined ? undefined : { signal: options.signal },
      );

      // 거절은 HTTP 200으로 온다 — content를 읽기 **전에** 확인해야 한다.
      if (response.stop_reason === "refusal") {
        const details = response.stop_details;
        throw new ModelRefusalError(details?.category ?? null, details?.explanation);
      }

      // id를 그대로 실어 보낸다 → addMessages가 같은 id를 교체로 처리한다(V8).
      // 툴 호출이 없으면 `ai`가 키를 안 만들어, 기존 동작과 결과가 **완전히 같다**.
      return ai(extractText(response), response.id, extractToolCalls(response));
    },
  };
}
