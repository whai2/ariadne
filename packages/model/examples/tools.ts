// 진짜 모델이 툴을 부르고, 우리가 답을 돌려주고, 모델이 최종 답을 내는 **한 바퀴** (F2.1).
//
//   bun run --filter '@ariadne/model' example:tools
//   bun run --filter '@ariadne/model' example:tools openrouter/openai/gpt-5 "3+4와 5×6은?"
//
// 요점 둘.
// 1. **문자열 규약이 없다.** studio의 ReAct 예제가 `"도구호출: calc"`로 흉내내던 것이
//    이제 `AIMessage.toolCalls` / `tool` 역할이라는 **구조**로 돈다.
// 2. **실행기가 없다.** 아래 `runTool`의 switch가 그 자리를 임시로 메운다 —
//    id를 손으로 맞추고, 인자를 손으로 믿고, 스키마를 손으로 적는다.
//    그게 F2.2(`@ariadne/tools`)를 부르는 벽이다.

import {
  END,
  human,
  isAIMessage,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  type ToolCall,
  tool,
} from "@ariadne/core";
import { model as resolveModel, type ToolSpec } from "../src/index";

const spec = process.argv[2] ?? "anthropic/claude-opus-5";
const question = process.argv[3] ?? "3+4와 5×6을 계산해줘. 툴을 써라.";

/** 모델에게 보여줄 선언. **손으로 쓴 JSON Schema** — TS 타입과 이어져 있지 않다(→ F2.2에서 zod로). */
const TOOLS: ToolSpec[] = [
  {
    name: "add",
    description: "두 수를 더한다",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "multiply",
    description: "두 수를 곱한다",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
];

/** 임시 실행기. 검증도 에러 정책도 없다 — 인자를 그냥 믿는다. */
function runTool(call: ToolCall): string {
  const a = Number(call.args.a);
  const b = Number(call.args.b);
  switch (call.name) {
    case "add":
      return String(a + b);
    case "multiply":
      return String(a * b);
    default:
      return `모르는 툴: ${call.name}`;
  }
}

const chat = resolveModel(spec, {
  system: "툴을 쓸 수 있으면 써라. 답은 간결하게.",
  maxTokens: 1024,
});
if (!chat.supportsTools) {
  console.error(
    `[${chat.provider}]는 툴을 실을 수 없다 — anthropic 또는 OpenAI 호환 프로바이더를 써라.`,
  );
  process.exit(1);
}

const g = new StateGraph<MessagesState>(messagesSchema);
g.addNode("model", async (s) => ({ messages: [await chat.invoke(s.messages, { tools: TOOLS })] }));
g.addNode("tools", (s) => {
  const calls = [...s.messages].reverse().find(isAIMessage)?.toolCalls ?? [];
  for (const c of calls) console.log(`    ↳ ${c.name}(${JSON.stringify(c.args)})`);
  // **호출 하나당 결과 하나, id를 그대로.** 하나라도 빠지면 다음 요청이 400이다.
  return { messages: calls.map((c) => tool(c.id, runTool(c))) };
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

console.log(`[${chat.provider} → ${chat.modelId}] ${question}\n`);

for await (const update of g.compile().stream({ messages: [human(question)] })) {
  console.log(`--- step ${update.step}: ${update.nodes.join(" · ")} ---`);
  for (const msg of update.state.messages) {
    const calls = isAIMessage(msg) ? (msg.toolCalls ?? []) : [];
    const suffix = calls.length === 0 ? "" : ` [${calls.map((c) => c.name).join(", ")} 호출]`;
    console.log(`  ${msg.role}: ${msg.content}${suffix}`);
  }
}
