// OpenAI 호환 어댑터 — **이 한 파일이 프로바이더 170개 이상을 책임진다.**
//
// OpenRouter · Groq · DeepSeek · Mistral · xAI · Fireworks · Cerebras · Moonshot ·
// Ollama · LM Studio … 전부 `POST {baseURL}/chat/completions`에 같은 모양으로 말한다.
// 그래서 어댑터가 아니라 **baseURL이 프로바이더를 정한다**(→ registry.ts).
//
// anthropic.ts와 나란히 놓고 보면 두 포맷의 차이가 드러난다:
//   Anthropic  system을 대화 밖 최상위 파라미터로 뽑아낸다
//   OpenAI     system이 **대화 배열 안에 그대로 산다**  ← 아래 toOpenAIMessages

import {
  type AIMessage,
  ai,
  type BaseMessage,
  isAIMessage,
  isToolMessage,
  type ToolCall,
} from "@ariadne/core";
import OpenAI from "openai";
import { EmptyConversationError } from "./errors";
import type { ChatModel, ChatOptions, ToolSpec } from "./types";

/** 기본 응답 상한. 비스트리밍 요청이 HTTP 타임아웃에 걸리지 않는 선. */
const DEFAULT_MAX_TOKENS = 16_000;

/** 이 어댑터가 쓰는 유일한 능력. 진짜 SDK도, 테스트 가짜도 이걸 만족한다. */
export type CreateCompletion = (
  body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

export interface OpenAICompatibleConfig {
  /** 모델 ID. 게이트웨이면 `"anthropic/claude-sonnet-4.5"`처럼 슬래시를 포함할 수 있다. */
  model: string;
  /** API 키. 생략하면 SDK가 `OPENAI_API_KEY`를 본다. */
  apiKey?: string;
  /** 베이스 URL. **이게 프로바이더를 정한다.** 생략하면 OpenAI 본가. */
  baseURL?: string;
  /** 관찰용 라벨. 라우터가 실제 프로바이더 id를 넣어준다. */
  provider?: string;
  maxTokens?: number;
  system?: string;
  /** 호출 함수 주입점(테스트용). */
  create?: CreateCompletion;
}

/**
 * core 메시지 → OpenAI 와이어 포맷. **순수 함수.**
 *
 * Anthropic과 달리 **뽑아낼 것도 접을 것도 없다** — system도 tool 결과도 그냥 배열 안의
 * 한 원소다. 그래서 이 함수는 끝까지 **1:1 map**으로 남는다. 툴 결과의 묶음 단위가
 * 두 포맷이 갈리는 지점이라는 게 여기서 눈에 보인다(anthropic.ts의 flushResults와 대조).
 *
 * 대신 이쪽이 흡수하는 비대칭이 따로 있다: **인자가 JSON 문자열이다.**
 */
export function toOpenAIMessages(
  messages: BaseMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "system") return { role: "system", content: msg.content };
    if (isToolMessage(msg)) {
      // 독립 메시지다 — Anthropic처럼 user 메시지 안의 블록이 아니다.
      // 실패 표시 자리가 없어서(`is_error` 같은 게 없다) 본문에 적어 보낸다.
      return {
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: msg.status === "error" ? `Error: ${msg.content}` : msg.content,
      };
    }
    if (isAIMessage(msg) && msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        // tool_calls가 있으면 content는 null이어도 된다(문서가 명시).
        content: msg.content === "" ? null : msg.content,
        tool_calls: msg.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          // 파싱된 객체에서 나온 것이라 이 stringify는 절대 안 터진다.
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      };
    }
    if (msg.role === "ai") return { role: "assistant", content: msg.content };
    return { role: "user", content: msg.content };
  });
}

/**
 * 응답의 tool_calls → 중립 `ToolCall[]`. **여기가 두 포맷이 만나는 지점이다.**
 *
 * OpenAI는 인자를 **JSON 문자열**로 준다. 그런데 SDK 문서가 대놓고 경고한다 —
 * "모델이 항상 유효한 JSON을 만들지는 않는다." 그래서 파싱 실패는 예외가 아니라 **데이터**로
 * 다룬다: 원문을 `invalidArgs`에 실어 보내면, 실행기가 "스키마 위반"과 "JSON 파손"을
 * 구분해서 모델에게 말해줄 수 있다. 여기서 던지면 그 구분이 영영 사라진다.
 */
export function toolCallsFrom(message: OpenAI.Chat.Completions.ChatCompletionMessage): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const call of message.tool_calls ?? []) {
    if (call.type !== "function") continue; // custom 툴은 우리가 안 보낸다
    const raw = call.function.arguments;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw === "" ? "{}" : raw);
    } catch {
      calls.push({ id: call.id, name: call.function.name, args: {}, invalidArgs: raw });
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      calls.push({ id: call.id, name: call.function.name, args: {}, invalidArgs: raw });
      continue;
    }
    calls.push({
      id: call.id,
      name: call.function.name,
      args: parsed as Record<string, unknown>,
    });
  }
  return calls;
}

/** 중립 툴 선언 → OpenAI `tools`. 한 겹 더 감싸는 것(`function`) 말고는 같다. */
export function toOpenAITools(specs: ToolSpec[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return specs.map((spec) => ({
    type: "function",
    function: {
      name: spec.name,
      ...(spec.description === undefined ? {} : { description: spec.description }),
      parameters: spec.parameters,
    },
  }));
}

/**
 * OpenAI 호환 채팅 모델을 만든다. 보통은 직접 부르지 않고 `model("groq/…")`이 부른다.
 *
 * ```ts
 * openaiCompatible({ model: "llama-3.3-70b", baseURL: "https://api.groq.com/openai/v1" })
 * ```
 */
export function openaiCompatible(config: OpenAICompatibleConfig): ChatModel {
  const defaultMaxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const create: CreateCompletion =
    config.create ??
    ((body, options) => {
      const client = new OpenAI({
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
      });
      return client.chat.completions.create(body, options);
    });

  return {
    provider: config.provider ?? "openai",
    modelId: config.model,
    supportsTools: true,

    async invoke(messages: BaseMessage[], options: ChatOptions = {}): Promise<AIMessage> {
      const converted = toOpenAIMessages(messages);
      // tool도 "보낼 턴"으로 안 친다 — 앞선 assistant의 tool_calls 없이 홀로 있는 tool 결과는
      // 서버가 400으로 거절한다. 역할이 늘면서 이 가드가 새로 놓치던 자리다.
      if (converted.every((m) => m.role === "system" || m.role === "tool")) {
        throw new EmptyConversationError();
      }

      // 모델 고정 · 호출별 시스템 지시는 대화 **앞에** 끼워 넣는다(포맷상 여기가 자리다).
      const prefix = [config.system, options.system]
        .filter((s): s is string => s !== undefined && s !== "")
        .map(
          (content): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
            role: "system",
            content,
          }),
        );

      const response = await create(
        {
          model: config.model,
          max_tokens: options.maxTokens ?? defaultMaxTokens,
          messages: [...prefix, ...converted],
          ...(options.tools === undefined || options.tools.length === 0
            ? {}
            : { tools: toOpenAITools(options.tools) }),
        },
        options.signal === undefined ? undefined : { signal: options.signal },
      );

      // id를 실어 보낸다 → addMessages가 같은 id를 교체로 처리한다(V8).
      const message = response.choices[0]?.message;
      return ai(
        message?.content ?? "",
        response.id,
        message === undefined ? undefined : toolCallsFrom(message),
      );
    },
  };
}
