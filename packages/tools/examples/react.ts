// 툴 링 데모 — **자격증명 0, 네트워크 0.**
//
//   bun run --filter '@ariadne/tools' example
//
// 모델이 가짜인 게 요점이다. 이 단계에서 검증할 건 모델의 똑똑함이 아니라 **툴 프로토콜**이라,
// 결정론적이어야 관찰이 된다. 진짜 모델은 F2.1의 `example:tools`가, 스튜디오는 F2.3이 맡는다.
//
// 두 장면을 보여준다:
//   1. 한 턴에 툴 **둘을 동시에** → toolNode가 병렬로 돌려 결과 둘을 id 순서대로
//   2. 모델이 인자를 **틀리게** 보냄 → 에러 메시지로 돌아오고, 다음 턴에 스스로 고침

import {
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
} from "@ariadne/core";
import { add, multiply, toolNode, toolSpecs, toolsCondition } from "../src/index";

const TOOLS = [add, multiply];

console.log("모델에게 보내는 선언 (zod 하나에서 나온 것):");
console.log(`${JSON.stringify(toolSpecs(TOOLS), null, 2)}\n`);

/** 대본대로 툴을 부르는 가짜 모델. 턴마다 다음 대본 줄을 쓴다. */
function scriptedModel(script: ToolCall[][]) {
  let turn = 0;
  return (s: MessagesState) => {
    const calls = script[turn];
    turn += 1;
    if (calls === undefined) {
      const results = s.messages.filter(isToolMessage).map((m) => m.content);
      return { messages: [ai(`정리하면: ${results.join(" · ")}`)] };
    }
    return { messages: [ai("", `m${turn}`, calls)] };
  };
}

async function scene(title: string, script: ToolCall[][]) {
  console.log(`━━━ ${title} ━━━`);
  const g = new StateGraph<MessagesState>(messagesSchema);
  g.addNode("model", scriptedModel(script));
  g.addNode("tools", toolNode<MessagesState>(TOOLS));
  g.addEdge(START, "model");
  g.addConditionalEdges("model", toolsCondition, ["tools", END]);
  g.addEdge("tools", "model");

  // 한 번만 돌린다 — 가짜 모델이 턴 카운터를 들고 있어서 두 번 돌리면 대본이 소진된다.
  let final: MessagesState = { messages: [] };
  for await (const update of g.compile().stream({ messages: [human("계산해줘")] })) {
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

// 1. 한 턴에 둘 — 병렬 실행 + 호출 id당 결과 하나
await scene("장면 1 · 한 턴에 툴 둘 (병렬)", [
  [
    { id: "call_1", name: "add", args: { a: 3, b: 4 } },
    { id: "call_2", name: "multiply", args: { a: 5, b: 6 } },
  ],
]);

// 2. 인자를 틀리게 → 에러 메시지 → 스스로 고침
await scene("장면 2 · 인자를 틀리게 보냄 → 모델이 고친다", [
  [{ id: "call_1", name: "add", args: { a: "셋", b: 4 } }],
  [{ id: "call_2", name: "add", args: { a: 3, b: 4 } }],
]);
