// 다리 테스트 — 서버 툴 선언이 우리 `Tool`이 되고, **그 뒤로는 로컬 툴과 구분이 없다**는 걸
// 확인한다. 마지막 테스트가 이 단계의 논지다: `createAgent`가 MCP 툴을 그냥 받는다.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAgent } from "@ariadne/agent";
import {
  type AIMessage,
  ai,
  type BaseMessage,
  Command,
  END,
  human,
  isToolMessage,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  type ToolCall,
} from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { type AnyTool, defineTool, toolNode, toolSpecs, toolsCondition } from "@ariadne/tools";
import { z } from "zod";
import { connectStdio, type McpClient } from "../src/client";
import { McpToolSchemaError } from "../src/errors";
import { mcpTools, renderContent } from "../src/tools";

const DEMO = `${import.meta.dir}/fixtures/demo-server.ts`;

let client: McpClient;
let tools: AnyTool[];

beforeAll(async () => {
  client = await connectStdio({ command: process.execPath, args: [DEMO] });
  tools = await mcpTools(client);
});
afterAll(async () => {
  await client.close();
});

describe("renderContent", () => {
  test("텍스트 블록들을 잇는다", () => {
    expect(
      renderContent([
        { type: "text", text: "가" },
        { type: "text", text: "나" },
      ]),
    ).toBe("가\n나");
  });

  test("텍스트가 아닌 블록은 **표식을 남긴다** — 조용히 사라지면 모델이 툴을 다시 부른다", () => {
    expect(renderContent([{ type: "image", data: "…", mimeType: "image/png" }])).toBe(
      "[image image/png]",
    );
  });

  test("내장 리소스의 텍스트는 진짜 내용이다", () => {
    expect(
      renderContent([{ type: "resource", resource: { uri: "file:///a", text: "본문" } }]),
    ).toBe("본문");
  });

  test("빈 결과는 빈 문자열", () => {
    expect(renderContent(undefined)).toBe("");
    expect(renderContent([])).toBe("");
  });
});

describe("서버 툴 → Tool", () => {
  test("`Tool` 모양을 그대로 채운다", () => {
    expect(tools.map((t) => t.name)).toEqual(["echo", "divide"]);
    expect(tools[0]?.description).toBe("받은 문자열을 그대로 돌려준다");
  });

  test("spec.parameters는 **서버 원본 그대로**다 (zod 왕복을 안 시킨다)", () => {
    // 되돌린 zod에서 JSON Schema를 다시 뽑으면 원본과 달라진다. 모델에게는 서버가 의도한
    // 계약이 가야 하므로 원본을 그대로 싣는다.
    expect(tools[0]?.spec.parameters).toEqual({
      type: "object",
      properties: {
        text: { type: "string", description: "돌려줄 문자열" },
        upper: { type: "boolean", description: "대문자로 바꿀지" },
      },
      required: ["text"],
      additionalProperties: false,
    });
  });

  test("schema는 검증용으로 되돌아온 zod다", () => {
    const schema = tools[0]?.schema;
    expect(schema?.safeParse({ text: "가" }).success).toBe(true);
    expect(schema?.safeParse({ upper: true }).success).toBe(false); // text 누락
    expect(schema?.safeParse({ text: 3 }).success).toBe(false); // 타입 위반
  });

  test("`toolSpecs()`로 모델 링에 그대로 넘어간다 — 로컬 툴과 같은 배열에 담긴다", () => {
    const local = defineTool({
      name: "now",
      description: "현재 시각",
      schema: z.object({}),
      execute: () => "…",
    });
    expect(toolSpecs([local, ...tools]).map((s) => s.name)).toEqual(["now", "echo", "divide"]);
  });

  test("표현 못 하는 inputSchema는 **툴 이름을 말하며** 던진다", async () => {
    // 서버가 스펙을 어겨 object가 아닌 inputSchema를 주는 경우. 목록을 주는 부분만 흉내 낸다.
    const stub = {
      listTools: async () => [
        { name: "weird", description: "이상한 툴", inputSchema: { type: "string" } },
      ],
    } as unknown as McpClient;
    expect(mcpTools(stub)).rejects.toThrow(McpToolSchemaError);
    expect(mcpTools(stub)).rejects.toThrow(/weird/); // 이름을 말해야 어디를 볼지 안다
  });
});

describe("toolNode 안에서 — 로컬 툴과 같은 길", () => {
  async function runTools(calls: ToolCall[]): Promise<BaseMessage[]> {
    const node = toolNode<MessagesState>(tools);
    const state: MessagesState = { messages: [ai("", "m1", calls)] };
    const out = await node(state);
    const update = out instanceof Command ? (out.update ?? {}) : out;
    return (update as Partial<MessagesState>).messages ?? [];
  }

  test("원격 툴 둘을 병렬로 돌리고 호출 순서대로 낸다", async () => {
    const messages = await runTools([
      { id: "call_1", name: "echo", args: { text: "가", upper: true } },
      { id: "call_2", name: "divide", args: { a: 8, b: 2 } },
    ]);
    expect(messages.map((m) => m.content)).toEqual(["가", "4"]);
    expect(messages.map((m) => (isToolMessage(m) ? m.toolCallId : ""))).toEqual([
      "call_1",
      "call_2",
    ]);
  });

  test("`isError`는 던지지 않고 **error 상태의 결과 메시지**로 돌아온다", async () => {
    const messages = await runTools([{ id: "call_1", name: "divide", args: { a: 1, b: 0 } }]);
    const first = messages[0];
    expect(first?.content).toBe("0으로 나눌 수 없다");
    // status가 실려야 어댑터가 와이어의 is_error로 옮긴다 — 모델이 "실패였다"를 안다.
    expect(isToolMessage(first as BaseMessage) && (first as { status?: string }).status).toBe(
      "error",
    );
  });

  test("인자가 스키마에 안 맞으면 **서버까지 안 간다** — zod가 우리 쪽에서 막는다", async () => {
    const messages = await runTools([{ id: "call_1", name: "echo", args: { text: 42 } }]);
    expect(messages[0]?.content).toContain("스키마에 안 맞는다");
  });
});

describe("createAgent가 MCP 툴을 그냥 받는다", () => {
  /** 대본대로 툴을 부르는 가짜 모델. 검증 대상이 배선이라 결정론적이어야 한다. */
  function scriptedModel(script: ToolCall[][]): ChatModel {
    let turn = 0;
    return {
      provider: "fake",
      modelId: "scripted",
      supportsTools: true,
      async invoke(messages: BaseMessage[]): Promise<AIMessage> {
        const calls = script[turn];
        turn += 1;
        if (calls !== undefined) return ai("", `m${turn}`, calls);
        const results = messages.filter(isToolMessage).map((m) => m.content);
        return ai(`정리하면: ${results.join(" · ")}`, `m${turn}`);
      },
    };
  }

  test("원격 툴로 ReAct 루프가 돈다 — 에이전트도 엔진도 무수정", async () => {
    const agent = createAgent({
      model: scriptedModel([
        [
          { id: "call_1", name: "echo", args: { text: "안녕" } },
          { id: "call_2", name: "divide", args: { a: 10, b: 4 } },
        ],
      ]),
      tools,
    });
    const out = await agent.invoke({ messages: [human("해줘")] });
    expect(out.messages.at(-1)?.content).toBe("정리하면: 안녕 · 2.5");
  });

  test("로컬 툴과 섞어도 된다 — 같은 배열, 같은 노드", async () => {
    const local = defineTool({
      name: "double",
      description: "두 배",
      schema: z.object({ n: z.number() }),
      execute: ({ n }) => n * 2,
    });
    const agent = createAgent({
      model: scriptedModel([
        [
          { id: "call_1", name: "double", args: { n: 21 } },
          { id: "call_2", name: "echo", args: { text: "원격" } },
        ],
      ]),
      tools: [local, ...tools],
    });
    const out = await agent.invoke({ messages: [human("해줘")] });
    expect(out.messages.at(-1)?.content).toBe("정리하면: 42 · 원격");
  });

  test("컴파일된 그래프라 스튜디오 관찰이 그대로 붙는다", () => {
    const agent = createAgent({ model: scriptedModel([]), tools });
    expect(agent.getGraph().nodes).toEqual(["model", "tools"]);
  });
});

describe("그래프에 직접 꽂아도 된다", () => {
  test("toolsCondition·addNode가 원격 툴을 구분하지 않는다", async () => {
    const g = new StateGraph<MessagesState>(messagesSchema);
    g.addNode("model", () => ({
      messages: [ai("", "m1", [{ id: "call_1", name: "echo", args: { text: "직접" } }])],
    }));
    g.addNode("tools", toolNode<MessagesState>(tools));
    g.addEdge(START, "model");
    g.addConditionalEdges("model", toolsCondition, ["tools", END]);
    const out = await g.compile().invoke({ messages: [human("가")] });
    expect(out.messages.at(-1)?.content).toBe("직접");
  });
});
