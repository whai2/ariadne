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
import type OpenAI from "openai";
import {
  type CreateCompletion,
  EmptyConversationError,
  openaiCompatible,
  toOpenAIMessages,
  toOpenAITools,
  toolCallsFrom,
} from "../src/index";

/** tool_calls를 실은 가짜 응답. `arguments`가 **문자열**인 게 이 포맷의 특징이다. */
function fakeToolResponse(args: string, id = "cmpl_t"): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id,
    object: "chat.completion",
    created: 0,
    model: "fake",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "add", arguments: args } },
          ],
        },
      },
    ],
  } as OpenAI.Chat.Completions.ChatCompletion;
}

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

  test("**툴 결과가 독립 메시지 1:1로 나간다** — Anthropic은 user 메시지 하나로 접었다", () => {
    expect(toOpenAIMessages([tool("call_1", "7"), tool("call_2", "30")])).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "7" },
      { role: "tool", tool_call_id: "call_2", content: "30" },
    ]);
  });

  test("실패 표시 자리가 없어서 본문에 적어 보낸다 (is_error가 없다)", () => {
    expect(toOpenAIMessages([tool("call_1", "터졌다", "error")])).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "Error: 터졌다" },
    ]);
  });

  test("**인자가 JSON 문자열로 나간다** — 중립형은 객체인데 여기서 직렬화된다", () => {
    expect(
      toOpenAIMessages([ai("", "m1", [{ id: "call_1", name: "add", args: { a: 3, b: 4 } }])]),
    ).toEqual([
      {
        role: "assistant",
        content: null, // tool_calls가 있으면 null이어도 된다
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "add", arguments: '{"a":3,"b":4}' } },
        ],
      },
    ]);
  });

  test("툴이 없는 ai 메시지는 예전과 똑같이 나간다", () => {
    expect(toOpenAIMessages([ai("4")])).toEqual([{ role: "assistant", content: "4" }]);
  });

  test("toOpenAITools — function으로 한 겹 감싸는 것 말고는 같다", () => {
    expect(
      toOpenAITools([
        { name: "add", description: "더한다", parameters: { type: "object", properties: {} } },
      ]),
    ).toEqual([
      {
        type: "function",
        function: {
          name: "add",
          description: "더한다",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });
});

describe("toolCallsFrom — 두 포맷이 만나는 지점 (F2.1)", () => {
  const messageOf = (r: OpenAI.Chat.Completions.ChatCompletion) =>
    // biome-ignore lint/style/noNonNullAssertion: 가짜 응답이라 항상 있다
    r.choices[0]!.message;

  test("JSON 문자열이 객체로 파싱된다 (Anthropic은 이미 객체였다)", () => {
    expect(toolCallsFrom(messageOf(fakeToolResponse('{"a":3,"b":4}')))).toEqual([
      { id: "call_1", name: "add", args: { a: 3, b: 4 } },
    ]);
  });

  test("**깨진 JSON은 던지지 않고 원문을 invalidArgs로 보존한다**", () => {
    expect(toolCallsFrom(messageOf(fakeToolResponse('{"a":3,')))).toEqual([
      { id: "call_1", name: "add", args: {}, invalidArgs: '{"a":3,' },
    ]);
  });

  test("객체가 아닌 JSON(배열·스칼라)도 같은 취급 — 인자는 객체여야 한다", () => {
    expect(toolCallsFrom(messageOf(fakeToolResponse("[1,2]")))).toEqual([
      { id: "call_1", name: "add", args: {}, invalidArgs: "[1,2]" },
    ]);
  });

  test("빈 문자열은 인자 없는 호출이다 (깨진 게 아니다)", () => {
    expect(toolCallsFrom(messageOf(fakeToolResponse("")))).toEqual([
      { id: "call_1", name: "add", args: {} },
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

  test("**tool 결과만 있어도 끊는다** — 짝이 없는 tool_result는 서버가 400으로 거절한다", async () => {
    const { calls, create } = recorder();
    const m = openaiCompatible({ model: "m", create });
    await expect(m.invoke([system("지시"), tool("call_1", "7")])).rejects.toThrow(
      EmptyConversationError,
    );
    expect(calls).toEqual([]);
  });

  test("supportsTools — 이 와이어는 툴 정의를 실을 수 있다", () => {
    expect(openaiCompatible({ model: "m", create: recorder().create }).supportsTools).toBe(true);
  });

  test("options.tools가 body.tools로 나가고, 안 주면 키가 아예 없다", async () => {
    const { calls, create } = recorder();
    const m = openaiCompatible({ model: "m", create });
    await m.invoke([human("hi")]);
    expect(calls[0]).not.toHaveProperty("tools");

    await m.invoke([human("hi")], {
      tools: [{ name: "now", parameters: { type: "object", properties: {} } }],
    });
    expect(calls[1]?.tools).toEqual([
      {
        type: "function",
        function: { name: "now", parameters: { type: "object", properties: {} } },
      },
    ]);
  });

  test("응답의 tool_calls가 AIMessage에 실린다 (content:null → 빈 문자열)", async () => {
    const { create } = recorder(fakeToolResponse('{"a":3,"b":4}', "cmpl_t"));
    const result = await openaiCompatible({ model: "m", create }).invoke([human("3+4는?")]);
    expect(result).toEqual({
      role: "ai",
      content: "",
      id: "cmpl_t",
      toolCalls: [{ id: "call_1", name: "add", args: { a: 3, b: 4 } }],
    });
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

test("OpenAI 사용량은 text/tool 모두 보존하고 캐시 상세를 중복 합산하지 않는다", async () => {
  for (const response of [fakeResponse("ok"), fakeToolResponse("{}")]) {
    response.usage = {
      prompt_tokens: 30,
      completion_tokens: 5,
      total_tokens: 35,
      prompt_tokens_details: { cached_tokens: 20 },
    };
    const { create } = recorder(response);
    const model = openaiCompatible({ provider: "fake", model: "fake", create });
    expect((await model.invoke([human("hi")])).usage).toEqual({ inputTokens: 30, outputTokens: 5 });
  }
});
