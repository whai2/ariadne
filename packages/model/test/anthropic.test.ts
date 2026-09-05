import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
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
  anthropicChat,
  type CreateMessage,
  EmptyConversationError,
  ModelRefusalError,
  toAnthropicMessages,
} from "../src/index";

/** 가짜 응답 한 개. 실제 SDK 응답 모양을 그대로 흉내낸다. */
function fakeResponse(text: string, over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...over,
  } as Anthropic.Message;
}

/** 보낸 body를 기록하는 가짜 호출자. 네트워크 없이 어댑터의 번역만 관찰한다. */
function recorder(response: Anthropic.Message = fakeResponse("안녕")) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (body) => {
    calls.push(body);
    return response;
  };
  return { calls, create };
}

describe("toAnthropicMessages — 순수 변환", () => {
  test("human→user, ai→assistant로 이름만 바뀌고 순서는 그대로", () => {
    const { system: sys, messages } = toAnthropicMessages([
      human("안녕"),
      ai("반가워요"),
      human("2+2는?"),
    ]);
    expect(sys).toEqual([]);
    expect(messages).toEqual([
      { role: "user", content: "안녕" },
      { role: "assistant", content: "반가워요" },
      { role: "user", content: "2+2는?" },
    ]);
  });

  test("system은 대화에서 빠져 따로 모인다 (Anthropic은 최상위 파라미터라서)", () => {
    const { system: sys, messages } = toAnthropicMessages([
      system("너는 수학 선생님이다"),
      human("2+2는?"),
      system("한국어로만 답해라"),
    ]);
    expect(sys).toEqual(["너는 수학 선생님이다", "한국어로만 답해라"]);
    expect(messages).toEqual([{ role: "user", content: "2+2는?" }]);
  });
});

describe("anthropicChat.invoke", () => {
  test("AIMessage를 돌려주고 응답 id를 그대로 싣는다", async () => {
    const { create } = recorder(fakeResponse("4입니다", { id: "msg_abc" }));
    const model = anthropicChat({ create });

    const result = await model.invoke([human("2+2는?")]);

    expect(result).toEqual({ role: "ai", content: "4입니다", id: "msg_abc" });
    expect(model.provider).toBe("anthropic");
    expect(model.modelId).toBe("claude-opus-5");
  });

  test("text 블록이 여럿이면 이어붙이고, text 아닌 블록은 버린다", async () => {
    const { create } = recorder(
      fakeResponse("", {
        content: [
          { type: "thinking", thinking: "음…", signature: "sig" },
          { type: "text", text: "앞", citations: null },
          { type: "text", text: "뒤", citations: null },
        ] as Anthropic.ContentBlock[],
      }),
    );
    const result = await anthropicChat({ create }).invoke([human("안녕")]);
    expect(result.content).toBe("앞뒤");
  });

  test("시스템 지시 세 출처가 모델→호출→대화 순으로 합쳐진다", async () => {
    const { calls, create } = recorder();
    const model = anthropicChat({ create, system: "모델 고정" });

    await model.invoke([system("대화 속"), human("안녕")], { system: "호출별" });

    expect(calls[0]?.system).toBe("모델 고정\n\n호출별\n\n대화 속");
  });

  test("system이 하나도 없으면 아예 안 보낸다", async () => {
    const { calls, create } = recorder();
    await anthropicChat({ create }).invoke([human("안녕")]);
    expect(calls[0]).not.toHaveProperty("system");
  });

  test("maxTokens는 기본값 16000, 호출 옵션이 이긴다", async () => {
    const { calls, create } = recorder();
    await anthropicChat({ create }).invoke([human("안녕")]);
    expect(calls[0]?.max_tokens).toBe(16_000);

    await anthropicChat({ create, maxTokens: 512 }).invoke([human("안녕")]);
    expect(calls[1]?.max_tokens).toBe(512);

    await anthropicChat({ create, maxTokens: 512 }).invoke([human("안녕")], { maxTokens: 99 });
    expect(calls[2]?.max_tokens).toBe(99);
  });

  test("보낼 대화가 없으면 호출 전에 끊는다", async () => {
    const { calls, create } = recorder();
    const model = anthropicChat({ create });

    await expect(model.invoke([])).rejects.toThrow(EmptyConversationError);
    await expect(model.invoke([system("지시만 있음")])).rejects.toThrow(EmptyConversationError);
    expect(calls).toEqual([]); // 네트워크까지 가지 않았다
  });

  test("거절은 HTTP 200으로 오므로 content를 읽기 전에 잡는다", async () => {
    const { create } = recorder(
      fakeResponse("", {
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "안 됨" },
      } as Partial<Anthropic.Message>),
    );
    await expect(anthropicChat({ create }).invoke([human("…")])).rejects.toThrow(ModelRefusalError);
  });
});

describe("그래프에 꽂기 — 모델 링이 core 위에 얹힌다", () => {
  test("model 노드 한 줄로 대화가 누적된다", async () => {
    const { create } = recorder(fakeResponse("4입니다", { id: "msg_1" }));
    const model = anthropicChat({ create });

    const g = new StateGraph<MessagesState>(messagesSchema);
    g.addNode("model", async (s) => ({ messages: [await model.invoke(s.messages)] }));
    g.addEdge(START, "model");
    g.addEdge("model", END);

    const out = await g.compile().invoke({ messages: [human("2+2는?")] });

    expect(out.messages).toEqual([
      { role: "human", content: "2+2는?" },
      { role: "ai", content: "4입니다", id: "msg_1" },
    ]);
  });

  test("멀티턴 자기 루프 — 매 턴 이전 대화 전체가 모델에 실려 간다", async () => {
    const { calls, create } = recorder(fakeResponse("응답", { id: "msg_same" }));
    const model = anthropicChat({ create });

    const g = new StateGraph<MessagesState & { turns: number }>({
      ...messagesSchema,
      turns: { reducer: (a, b) => a + b },
    });
    g.addNode("model", async (s) => ({
      messages: [await model.invoke(s.messages)],
      turns: 1,
    }));
    g.addEdge(START, "model");
    g.addConditionalEdges("model", (s) => (s.turns < 3 ? "model" : END));

    const out = await g.compile().invoke({ messages: [human("안녕")], turns: 0 });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.messages).toHaveLength(1); // 첫 턴: 사람 메시지만
    expect(calls[1]?.messages).toHaveLength(2); // 이전 AI 응답이 실려 감
    expect(calls[2]?.messages).toHaveLength(2); // id가 같아 addMessages가 교체 → 안 늘어남
    expect(out.turns).toBe(3);
  });
});

// 실제 호출. 키가 없으면 통째로 건너뛴다 — CI/오프라인에서도 verify가 그린이어야 하므로.
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
describe.skipIf(!hasKey)("실제 Claude 호출 (ANTHROPIC_API_KEY 있을 때만)", () => {
  test("진짜 모델이 답한다", async () => {
    const model = anthropicChat({ maxTokens: 64 });
    const result = await model.invoke([human("'pong'이라고만 답해라.")]);
    expect(result.role).toBe("ai");
    expect(result.content.length).toBeGreaterThan(0);
  }, 60_000);
});
