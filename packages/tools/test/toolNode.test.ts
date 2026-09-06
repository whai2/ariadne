import { describe, expect, test } from "bun:test";
import {
  ai,
  Command,
  END,
  human,
  isToolMessage,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  type ToolCall,
  tool,
} from "@ariadne/core";
import { z } from "zod";
import {
  add,
  coerceContent,
  defineTool,
  lastToolCalls,
  MissingToolMessageError,
  multiply,
  toolNode,
  toolsCondition,
} from "../src/index";

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({
  id,
  name,
  args,
});

/** toolNode를 그래프 없이 직접 부른다(노드는 그냥 함수라 가능하다). */
async function run(tools: Parameters<typeof toolNode>[0], messages: MessagesState["messages"]) {
  const node = toolNode<MessagesState>(tools);
  return await node({ messages });
}

describe("lastToolCalls", () => {
  test("**뒤에서부터 AI 메시지를 찾는다** — at(-1)이 아니다(뒤에 tool 결과가 붙는다)", () => {
    const calls = [call("call_1", "add", { a: 1, b: 2 })];
    expect(lastToolCalls([human("3+4?"), ai("", "m1", calls), tool("call_1", "3")])).toEqual(calls);
  });

  test("AI 메시지가 없거나 툴 호출이 없으면 빈 배열", () => {
    expect(lastToolCalls([human("안녕")])).toEqual([]);
    expect(lastToolCalls([ai("답")])).toEqual([]);
  });
});

describe("toolsCondition", () => {
  test("툴 호출이 있으면 'tools', 없으면 END — 고정 리터럴이다", () => {
    expect(toolsCondition({ messages: [ai("", "m1", [call("c1", "add", {})])] })).toBe("tools");
    expect(toolsCondition({ messages: [ai("답")] })).toBe(END);
  });
});

describe("coerceContent", () => {
  test("문자열은 그대로, 그 외는 JSON, 순환 참조는 String() 폴백", () => {
    expect(coerceContent("7")).toBe("7");
    expect(coerceContent({ a: 1 })).toBe('{"a":1}');
    expect(coerceContent(7)).toBe("7");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(coerceContent(cyclic)).toBe("[object Object]");
    expect(coerceContent(undefined)).toBe("undefined"); // JSON.stringify가 undefined를 준다
  });
});

describe("toolNode — 실행 계약", () => {
  test("툴 호출이 없으면 빈 업데이트", async () => {
    expect(await run([add], [human("안녕")])).toEqual({});
  });

  test("**호출 3개 → 결과 3개, id가 1:1로 짝지어지고 순서가 보존된다**", async () => {
    const calls = [
      call("c1", "add", { a: 3, b: 4 }),
      call("c2", "multiply", { a: 5, b: 6 }),
      call("c3", "add", { a: 1, b: 1 }),
    ];
    const out = await run([add, multiply], [ai("", "m1", calls)]);
    const messages = (out as MessagesState).messages;
    expect(messages.map((m) => (isToolMessage(m) ? m.toolCallId : "?"))).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(messages.map((m) => m.content)).toEqual(["7", "30", "2"]);
  });

  test("**병렬로 돈다** — 지연 툴 둘의 총 소요가 합보다 작다", async () => {
    const slow = (name: string) =>
      defineTool({
        name,
        description: "느린 툴",
        schema: z.object({}),
        execute: async () => {
          await new Promise((r) => setTimeout(r, 60));
          return name;
        },
      });
    const started = Date.now();
    await run([slow("a"), slow("b")], [ai("", "m1", [call("c1", "a", {}), call("c2", "b", {})])]);
    expect(Date.now() - started).toBeLessThan(110); // 순차라면 120ms 이상
  });
});

describe("toolNode — 에러 정책의 분기", () => {
  test("모르는 툴 이름 → **쓸 수 있는 이름 목록을 알려준다**(모델이 다음 턴에 고친다)", async () => {
    const out = await run([add, multiply], [ai("", "m1", [call("c1", "divide", {})])]);
    const results = (out as MessagesState).messages.filter(isToolMessage);
    expect(results.map((m) => m.status)).toEqual(["error"]);
    expect(results[0]?.content).toContain("add, multiply");
  });

  test("인자가 스키마에 안 맞으면 **안 던지고** 무엇이 틀렸는지 적어 돌려준다", async () => {
    const out = await run([add], [ai("", "m1", [call("c1", "add", { a: "3", b: 4 })])]);
    const results = (out as MessagesState).messages.filter(isToolMessage);
    expect(results.map((m) => m.status)).toEqual(["error"]);
    expect(results[0]?.content).toContain("expected number");
    expect(results[0]?.content).toContain("a");
  });

  test("깨진 JSON은 **스키마 위반과 다른 문구**로 말한다 (원인이 다르다)", async () => {
    const broken: ToolCall = { id: "c1", name: "add", args: {}, invalidArgs: '{"a":3,' };
    const out = await run([add], [ai("", "m1", [broken])]);
    const msg = (out as MessagesState).messages[0];
    expect(msg?.content).toContain("올바른 JSON이 아니다");
    expect(msg?.content).toContain('{"a":3,');
  });

  test("**툴 본문이 던지면 전파된다** — 그건 우리 버그지 모델이 사과할 일이 아니다", async () => {
    const boom = defineTool({
      name: "boom",
      description: "터진다",
      schema: z.object({}),
      execute: () => {
        throw new Error("내부 버그");
      },
    });
    await expect(run([boom], [ai("", "m1", [call("c1", "boom", {})])])).rejects.toThrow(
      "내부 버그",
    );
  });

  test("검증을 통과한 인자가 execute에 간다 (기본값이 채워진 값)", async () => {
    const seen: unknown[] = [];
    const withDefault = defineTool({
      name: "unit",
      description: "단위를 붙인다",
      schema: z.object({ v: z.number(), unit: z.string().default("cm") }),
      execute: (args) => {
        seen.push(args);
        return `${args.v}${args.unit}`;
      },
    });
    const out = await run([withDefault], [ai("", "m1", [call("c1", "unit", { v: 3 })])]);
    expect(seen).toEqual([{ v: 3, unit: "cm" }]);
    expect((out as MessagesState).messages[0]?.content).toBe("3cm");
  });
});

describe("toolNode — Command 반환", () => {
  const setFlag = defineTool({
    name: "setFlag",
    description: "상태를 바꾼다",
    schema: z.object({}),
    execute: (_args, ctx) =>
      new Command<MessagesState & { flag: string }>({
        update: { messages: [tool(ctx.toolCallId, "바꿨다")], flag: "on" },
      }),
  });

  test("update가 병합되고 결과 메시지도 같이 실린다", async () => {
    const node = toolNode<MessagesState & { flag: string }>([setFlag]);
    const out = await node({ messages: [ai("", "m1", [call("c1", "setFlag", {})])], flag: "off" });
    expect(out).toBeInstanceOf(Command);
    const update = (out as Command<MessagesState & { flag: string }>).update;
    expect(update?.flag).toBe("on");
    expect(update?.messages?.map((m) => m.content)).toEqual(["바꿨다"]);
  });

  test("**자기 결과 메시지가 없으면 MissingToolMessageError** — 답 없는 tool_use는 400이다", async () => {
    const forgetful = defineTool({
      name: "forgetful",
      description: "결과 메시지를 안 만든다",
      schema: z.object({}),
      execute: () => new Command<MessagesState>({ update: { messages: [] } }),
    });
    await expect(run([forgetful], [ai("", "m1", [call("c1", "forgetful", {})])])).rejects.toThrow(
      MissingToolMessageError,
    );
  });

  test("Command와 일반 툴이 섞여도 하나로 접히고 messages는 호출 순서대로", async () => {
    const node = toolNode<MessagesState & { flag: string }>([add, setFlag]);
    const out = await node({
      messages: [ai("", "m1", [call("c1", "add", { a: 1, b: 1 }), call("c2", "setFlag", {})])],
      flag: "off",
    });
    const update = (out as Command<MessagesState & { flag: string }>).update;
    expect(update?.messages?.map((m) => m.content)).toEqual(["2", "바꿨다"]);
    expect(update?.flag).toBe("on");
  });

  test("messages 밖의 같은 키를 둘이 쓰면 **나중 것이 이긴다** (NodeReturn이 단일 값이라서)", async () => {
    const setter = (name: string, value: string) =>
      defineTool({
        name,
        description: "flag를 쓴다",
        schema: z.object({}),
        execute: (_a, ctx) =>
          new Command<MessagesState & { flag: string }>({
            update: { messages: [tool(ctx.toolCallId, name)], flag: value },
          }),
      });
    const node = toolNode<MessagesState & { flag: string }>([
      setter("x", "먼저"),
      setter("y", "나중"),
    ]);
    const out = await node({
      messages: [ai("", "m1", [call("c1", "x", {}), call("c2", "y", {})])],
      flag: "off",
    });
    // 채널 리듀서에 닿기 전에 충돌한다 — langgraph는 Command 리스트를 반환해 이걸 피한다.
    expect((out as Command<MessagesState & { flag: string }>).update?.flag).toBe("나중");
  });
});

describe("그래프에 꽂기", () => {
  /** 가짜 모델: 툴 결과가 아직 없으면 부르고, 있으면 답한다. */
  const fakeModel = (calls: ToolCall[]) => (s: MessagesState) =>
    s.messages.some(isToolMessage)
      ? { messages: [ai("답 나왔다")] }
      : { messages: [ai("", "m1", calls)] };

  test("ReAct 한 바퀴 — 한 턴에 툴 둘을 부르고 결과 둘이 돌아온다", async () => {
    const g = new StateGraph<MessagesState>(messagesSchema);
    g.addNode(
      "model",
      fakeModel([call("c1", "add", { a: 3, b: 4 }), call("c2", "multiply", { a: 5, b: 6 })]),
    );
    g.addNode("tools", toolNode<MessagesState>([add, multiply]));
    g.addEdge(START, "model");
    g.addConditionalEdges("model", toolsCondition, ["tools", END]);
    g.addEdge("tools", "model");

    const steps = [];
    for await (const s of g.compile().stream({ messages: [human("3+4와 5×6은?")] })) {
      steps.push(s);
    }
    expect(steps.map((s) => s.nodes)).toEqual([["model"], ["tools"], ["model"]]);

    const messages = steps.at(-1)?.state.messages ?? [];
    expect(messages.map((m) => m.role)).toEqual(["human", "ai", "tool", "tool", "ai"]);
    expect(messages.filter(isToolMessage).map((m) => m.toolCallId)).toEqual(["c1", "c2"]);
    expect(messages.filter(isToolMessage).map((m) => m.content)).toEqual(["7", "30"]);
  });

  test("**`goto: END`는 정적 엣지를 취소하지 못한다 — goto는 더하기다**", async () => {
    // V7에서 제어흐름이 채널 쓰기가 됐고, 쓰기는 합집합이다. END는 아무 채널에도 안 쓰므로
    // 정적 엣지 tools→model이 쓴 branch:to:model이 그대로 남아 model이 또 깨어난다.
    const bail = defineTool({
      name: "bail",
      description: "여기서 멈추고 싶어한다",
      schema: z.object({}),
      execute: (_a, ctx) =>
        new Command<MessagesState>({
          update: { messages: [tool(ctx.toolCallId, "그만")] },
          goto: END,
        }),
    });

    const g = new StateGraph<MessagesState>(messagesSchema);
    g.addNode("model", fakeModel([call("c1", "bail", {})]));
    g.addNode("tools", toolNode<MessagesState>([bail]));
    g.addEdge(START, "model");
    g.addConditionalEdges("model", toolsCondition, ["tools", END]);
    g.addEdge("tools", "model"); // ← 이게 있으면 goto: END로는 못 끊는다

    const steps = [];
    for await (const s of g.compile().stream({ messages: [human("멈춰")] })) {
      steps.push(s);
    }
    // goto: END가 먹혔다면 [model, tools]에서 끝났어야 한다. 실제로는 model이 한 번 더 돈다.
    expect(steps.map((s) => s.nodes)).toEqual([["model"], ["tools"], ["model"]]);
  });
});
