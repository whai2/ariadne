import { describe, expect, it } from "bun:test";
import {
  addMessages,
  ai,
  END,
  human,
  isAIMessage,
  isToolMessage,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  type ToolCall,
  tool,
} from "../src";

describe("V8 · MessagesState + addMessages", () => {
  describe("addMessages 리듀서", () => {
    it("기본은 append (뒤에 붙임)", () => {
      const out = addMessages([human("안녕")], [ai("반가워요")]);
      expect(out.map((m) => [m.role, m.content])).toEqual([
        ["human", "안녕"],
        ["ai", "반가워요"],
      ]);
    });

    it("같은 id면 append 대신 교체 (append-only의 예외)", () => {
      const out = addMessages([human("초안", "1")], [human("수정", "1")]);
      expect(out).toEqual([human("수정", "1")]);
    });

    it("다른 id면 그냥 append", () => {
      const out = addMessages([human("a", "1")], [ai("b", "2")]);
      expect(out.length).toBe(2);
    });
  });

  it("캡스톤: 챗봇 그래프에서 대화가 누적된다", async () => {
    const g = new StateGraph<MessagesState>(messagesSchema);
    // 가짜 모델: 마지막 human 메시지에 echo로 답한다
    g.addNode("model", (s) => {
      const lastHuman = [...s.messages].reverse().find((m) => m.role === "human");
      return { messages: [ai(`echo: ${lastHuman?.content ?? ""}`)] };
    });
    g.addEdge(START, "model");
    g.addEdge("model", END);

    const out = await g.compile().invoke({ messages: [human("안녕?")] });
    expect(out.messages.map((m) => [m.role, m.content])).toEqual([
      ["human", "안녕?"],
      ["ai", "echo: 안녕?"],
    ]);
  });

  it("캡스톤: 멀티턴 루프로 메시지가 스텝마다 쌓인다", async () => {
    interface Chat extends MessagesState {
      turns: number;
    }
    const g = new StateGraph<Chat>({ messages: { reducer: addMessages } });
    g.addNode("model", (s) => ({ messages: [ai(`turn ${s.turns + 1}`)], turns: s.turns + 1 }));
    g.addEdge(START, "model");
    g.addConditionalEdges("model", (s) => (s.turns < 3 ? "model" : END));

    const out = await g.compile().invoke({ messages: [human("start")], turns: 0 });
    expect(out.messages.map((m) => m.content)).toEqual(["start", "turn 1", "turn 2", "turn 3"]);
    expect(out.turns).toBe(3);
  });

  it("messages는 리듀서 채널(BinaryOperatorAggregate)로 컴파일된다", async () => {
    const g = new StateGraph<MessagesState>(messagesSchema);
    g.addNode("model", () => ({ messages: [ai("hi")] }));
    g.addEdge(START, "model");
    g.addEdge("model", END);

    const steps = [];
    for await (const s of g.compile().stream({ messages: [] })) {
      steps.push(s);
    }
    const ch = steps.at(-1)?.channels.find((c) => c.key === "messages");
    expect(ch?.type).toBe("BinaryOperatorAggregate");
  });
});

describe("F2.1 · 툴 호출 어휘", () => {
  const call: ToolCall = { id: "call_1", name: "add", args: { a: 3, b: 4 } };

  describe("빈 값이면 키를 안 만든다 (기존 코드 보호 계약)", () => {
    it("**`ai('답')`은 toolCalls 키가 없다** — 기존 whole-object 비교가 전부 이걸 믿고 있다", () => {
      expect(ai("답")).toEqual({ role: "ai", content: "답" });
      expect(ai("답")).not.toHaveProperty("toolCalls");
    });

    it("빈 배열을 넘겨도 키를 안 만든다 (어댑터가 항상 배열을 넘기므로 여기가 중요하다)", () => {
      expect(ai("답", "m1", [])).toEqual({ role: "ai", content: "답", id: "m1" });
    });

    it("툴 호출이 있으면 그때만 실린다", () => {
      expect(ai("", "m1", [call])).toEqual({
        role: "ai",
        content: "",
        id: "m1",
        toolCalls: [call],
      });
    });

    it("`tool()`은 status가 없으면 키를 안 만든다", () => {
      expect(tool("call_1", "7")).toEqual({ role: "tool", content: "7", toolCallId: "call_1" });
    });

    it("실패면 status가 실린다", () => {
      expect(tool("call_1", "터졌다", "error")).toEqual({
        role: "tool",
        content: "터졌다",
        toolCallId: "call_1",
        status: "error",
      });
    });

    it("**`tool()`은 id를 안 받는다** — toolCallId를 id로 쓰면 재실행이 앞 결과를 덮는다", () => {
      expect(tool("call_1", "7")).not.toHaveProperty("id");
    });
  });

  describe("리듀서는 여전히 content-blind다 (엔진이 안 움직인 증거)", () => {
    it("tool 메시지도 그냥 append된다 — addMessages는 한 글자도 안 바뀌었다", () => {
      const out = addMessages([human("3+4?"), ai("", "m1", [call])], [tool("call_1", "7")]);
      expect(out.map((m) => m.role)).toEqual(["human", "ai", "tool"]);
    });

    it("같은 id면 toolCalls까지 통째로 교체된다", () => {
      const out = addMessages([ai("", "m1", [call])], [ai("답: 7", "m1")]);
      expect(out).toEqual([{ role: "ai", content: "답: 7", id: "m1" }]);
    });
  });

  describe("타입 가드", () => {
    it("role만으로는 안 좁혀져서 가드가 필요하다 — 그래서 어댑터 두 곳이 이걸 쓴다", () => {
      const messages = [human("안녕"), ai("", "m1", [call]), tool("call_1", "7")];
      expect(messages.filter(isAIMessage).flatMap((m) => m.toolCalls ?? [])).toEqual([call]);
      expect(messages.filter(isToolMessage).map((m) => m.toolCallId)).toEqual(["call_1"]);
    });
  });

  it("그래프 통합: 툴 한 바퀴가 문자열 규약 없이 돈다", async () => {
    const g = new StateGraph<MessagesState>(messagesSchema);
    // 가짜 모델: 툴 결과가 아직 없으면 호출하고, 있으면 답한다.
    g.addNode("model", (s) => {
      const result = s.messages.find(isToolMessage);
      if (result !== undefined) return { messages: [ai(`답: ${result.content}`)] };
      return { messages: [ai("", "m1", [call])] };
    });
    g.addNode("tools", (s) => {
      const calls = [...s.messages].reverse().find(isAIMessage)?.toolCalls ?? [];
      return {
        messages: calls.map((c) => tool(c.id, String(Number(c.args.a) + Number(c.args.b)))),
      };
    });
    g.addEdge(START, "model");
    g.addConditionalEdges(
      "model",
      (s) => {
        const last = [...s.messages].reverse().find(isAIMessage);
        return (last?.toolCalls?.length ?? 0) > 0 ? "tools" : END;
      },
      ["tools", END],
    );
    g.addEdge("tools", "model");

    const out = await g.compile().invoke({ messages: [human("3+4는?")] });
    expect(out.messages.map((m) => m.role)).toEqual(["human", "ai", "tool", "ai"]);
    // **id 불변식**: 호출된 id 집합과 결과가 가리키는 id 집합이 정확히 같다.
    const called = out.messages.filter(isAIMessage).flatMap((m) => m.toolCalls ?? []);
    const answered = out.messages.filter(isToolMessage);
    expect(called.map((c) => c.id)).toEqual(["call_1"]);
    expect(answered.map((m) => m.toolCallId)).toEqual(called.map((c) => c.id));
    expect(out.messages.at(-1)?.content).toBe("답: 7");
  });
});
