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
import type OpenAI from "openai";
import {
  type CreateCompletion,
  EmptyConversationError,
  openaiCompatible,
  toOpenAIMessages,
} from "../src/index";

function fakeResponse(text: string, id = "cmpl_fake"): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id,
    object: "chat.completion",
    created: 0,
    model: "fake",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: { role: "assistant", content: text, refusal: null },
      },
    ],
  } as OpenAI.Chat.Completions.ChatCompletion;
}

function recorder(response = fakeResponse("안녕")) {
  const calls: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming[] = [];
  const create: CreateCompletion = async (body) => {
    calls.push(body);
    return response;
  };
  return { calls, create };
}

describe("toOpenAIMessages — Anthropic과 갈리는 지점", () => {
  test("system이 **대화 배열 안에 그대로 남는다** (Anthropic은 뽑아냈다)", () => {
    expect(toOpenAIMessages([system("너는 수학 선생님"), human("2+2는?"), ai("4")])).toEqual([
      { role: "system", content: "너는 수학 선생님" },
      { role: "user", content: "2+2는?" },
      { role: "assistant", content: "4" },
    ]);
  });
});

describe("openaiCompatible", () => {
  test("baseURL이 프로바이더를 정한다 — 어댑터는 그대로", async () => {
    const { calls, create } = recorder(fakeResponse("4입니다", "cmpl_1"));
    const m = openaiCompatible({
      model: "anthropic/claude-sonnet-4.5",
      baseURL: "https://openrouter.ai/api/v1",
      provider: "openrouter",
      create,
    });

    const result = await m.invoke([human("2+2는?")]);

    expect(m.provider).toBe("openrouter");
    expect(result).toEqual({ role: "ai", content: "4입니다", id: "cmpl_1" });
    expect(calls[0]?.model).toBe("anthropic/claude-sonnet-4.5"); // 슬래시째 그대로
  });

  test("시스템 지시는 대화 **앞에** 끼워 넣는다", async () => {
    const { calls, create } = recorder();
    const m = openaiCompatible({ model: "m", system: "모델 고정", create });

    await m.invoke([human("안녕")], { system: "호출별" });

    expect(calls[0]?.messages).toEqual([
      { role: "system", content: "모델 고정" },
      { role: "system", content: "호출별" },
      { role: "user", content: "안녕" },
    ]);
  });

  test("maxTokens 기본 16000, 호출 옵션이 이긴다", async () => {
    const { calls, create } = recorder();
    await openaiCompatible({ model: "m", create }).invoke([human("hi")]);
    expect(calls[0]?.max_tokens).toBe(16_000);

    await openaiCompatible({ model: "m", create }).invoke([human("hi")], { maxTokens: 42 });
    expect(calls[1]?.max_tokens).toBe(42);
  });

  test("system만 있으면 호출 전에 끊는다", async () => {
    const { calls, create } = recorder();
    const m = openaiCompatible({ model: "m", create });
    await expect(m.invoke([])).rejects.toThrow(EmptyConversationError);
    await expect(m.invoke([system("지시만")])).rejects.toThrow(EmptyConversationError);
    expect(calls).toEqual([]);
  });

  test("content가 null이어도 빈 문자열로 안전하게 떨어진다", async () => {
    const empty = fakeResponse("");
    const choice = empty.choices[0];
    if (choice) choice.message.content = null;
    const { create } = recorder(empty);
    expect((await openaiCompatible({ model: "m", create }).invoke([human("hi")])).content).toBe("");
  });

  test("그래프에 꽂으면 Anthropic 어댑터와 **똑같이** 동작한다", async () => {
    const { create } = recorder(fakeResponse("4입니다", "cmpl_2"));
    const m = openaiCompatible({ model: "m", create });

    const g = new StateGraph<MessagesState>(messagesSchema);
    g.addNode("model", async (s) => ({ messages: [await m.invoke(s.messages)] }));
    g.addEdge(START, "model");
    g.addEdge("model", END);

    const out = await g.compile().invoke({ messages: [human("2+2는?")] });

    expect(out.messages).toEqual([
      { role: "human", content: "2+2는?" },
      { role: "ai", content: "4입니다", id: "cmpl_2" },
    ]);
  });
});
