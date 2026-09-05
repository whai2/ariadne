// OpenAI 호환 어댑터 — **이 한 파일이 프로바이더 170개 이상을 책임진다.**
//
// OpenRouter · Groq · DeepSeek · Mistral · xAI · Fireworks · Cerebras · Moonshot ·
// Ollama · LM Studio … 전부 `POST {baseURL}/chat/completions`에 같은 모양으로 말한다.
// 그래서 어댑터가 아니라 **baseURL이 프로바이더를 정한다**(→ registry.ts).
//
// anthropic.ts와 나란히 놓고 보면 두 포맷의 차이가 드러난다:
//   Anthropic  system을 대화 밖 최상위 파라미터로 뽑아낸다
//   OpenAI     system이 **대화 배열 안에 그대로 산다**  ← 아래 toOpenAIMessages

import { type AIMessage, ai, type BaseMessage } from "@ariadne/core";
import OpenAI from "openai";
import { EmptyConversationError } from "./errors";
import type { ChatModel, ChatOptions } from "./types";

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
 * Anthropic과 달리 **뽑아낼 게 없다** — system도 그냥 배열 안의 한 원소다.
 * 역할 이름만 바꾸면 끝: human → user, ai → assistant, system → system.
 */
export function toOpenAIMessages(
  messages: BaseMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "system") return { role: "system", content: msg.content };
    if (msg.role === "ai") return { role: "assistant", content: msg.content };
    return { role: "user", content: msg.content };
  });
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

    async invoke(messages: BaseMessage[], options: ChatOptions = {}): Promise<AIMessage> {
      const converted = toOpenAIMessages(messages);
      if (converted.every((m) => m.role === "system")) {
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
        },
        options.signal === undefined ? undefined : { signal: options.signal },
      );

      // id를 실어 보낸다 → addMessages가 같은 id를 교체로 처리한다(V8).
      return ai(response.choices[0]?.message.content ?? "", response.id);
    },
  };
}
