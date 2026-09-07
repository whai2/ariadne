// MCP 링 데모 — **자격증명 0, 네트워크 0.**
//
//   bun run --filter '@ariadne/mcp' example
//
// 보여주려는 건 하나다: **MCP 서버의 툴이 로컬 툴과 구분 없이 같은 배열에 담긴다.**
// 그 뒤로는 `createAgent`도 `toolNode`도 엔진도 원격인 줄 모른다.
//
// 모델이 가짜인 건 F2.2의 이유 그대로다 — 검증 대상이 **툴이 어디서 왔는가**라
// 결정론적이어야 관찰이 된다. 서버는 진짜다(자식 프로세스 + JSON-RPC 왕복).

import { createAgent } from "@ariadne/agent";
import {
  type AIMessage,
  ai,
  type BaseMessage,
  human,
  isAIMessage,
  isToolMessage,
  type ToolCall,
} from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { connectStdio, mcpTools } from "../src/index";

const server = await connectStdio({
  command: process.execPath,
  args: [`${import.meta.dir}/../test/fixtures/demo-server.ts`],
});
console.log(`붙은 서버: ${server.serverInfo.name} (MCP ${server.protocolVersion})\n`);

const remote = await mcpTools(server);
console.log("서버가 준 툴 — 우리가 한 줄도 안 적은 것들:");
for (const t of remote) console.log(`  ${t.name}: ${t.description}`);

// 로컬 툴 하나를 섞는다. 여기서부터 둘의 출신이 안 보인다.
const double = defineTool({
  name: "double",
  description: "두 배로",
  schema: z.object({ n: z.number() }),
  execute: ({ n }) => n * 2,
});
const tools = [double, ...remote];
console.log(
  `\n에이전트가 든 툴: ${tools.map((t) => t.name).join(", ")} (로컬 1 + 원격 ${remote.length})\n`,
);

/** 대본대로 툴을 부르는 가짜 모델. */
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

async function scene(title: string, script: ToolCall[][]): Promise<void> {
  console.log(`━━━ ${title} ━━━`);
  const agent = createAgent({ model: scriptedModel(script), tools });
  let final: { messages: BaseMessage[] } = { messages: [] };
  for await (const update of agent.stream({ messages: [human("해줘")] })) {
    console.log(`  step ${update.step}: ${update.nodes.join(" · ")}`);
    final = update.state;
  }
  for (const msg of final.messages) {
    const calls = isAIMessage(msg) ? (msg.toolCalls ?? []) : [];
    const label = calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ");
    const mark = isToolMessage(msg) && msg.status === "error" ? " ✗" : "";
    console.log(`  ${msg.role}${mark}: ${msg.content}${label === "" ? "" : ` → ${label}`}`);
  }
  console.log();
}

// 1. 로컬 툴과 원격 툴을 한 턴에 나란히 — toolNode가 병렬로 돌린다.
await scene("장면 1 · 로컬 툴 + 원격 툴, 한 턴에 병렬", [
  [
    { id: "call_1", name: "double", args: { n: 21 } },
    { id: "call_2", name: "echo", args: { text: "원격에서 왔다", upper: false } },
  ],
]);

// 2. 원격 툴이 실패(isError) → 던지지 않고 error 상태 메시지로 → 모델이 고친다.
await scene("장면 2 · 원격 툴 실패(isError)는 모델에게 돌아간다", [
  [{ id: "call_1", name: "divide", args: { a: 1, b: 0 } }],
  [{ id: "call_2", name: "divide", args: { a: 1, b: 2 } }],
]);

// **연결은 우리가 닫는다.** 에이전트가 아니라 여기가 수명의 주인이다 —
// 그래서 `createAgent`는 여전히 상태 없는 함수로 남는다.
await server.close();
console.log("서버 닫음.");
