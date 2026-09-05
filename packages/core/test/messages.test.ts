import { describe, expect, it } from "bun:test";
import {
  addMessages,
  ai,
  END,
  human,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
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
