// 실제 Claude를 붙인 최소 챗봇 그래프 — F1이 "진짜로 도는지" 눈으로 보는 데모.
//
//   ANTHROPIC_API_KEY=sk-... bun run --filter '@ariadne/model' example
//   ANTHROPIC_API_KEY=sk-... bun run --filter '@ariadne/model' example "질문"
//
// V8 캡스톤(messagesSchema)에서 가짜 함수였던 model 노드를 진짜 모델로 바꾼 것뿐이다.
// 그래프 구조는 한 글자도 안 바뀐다 — 그게 이 링의 요점이다.

import { END, human, type MessagesState, messagesSchema, START, StateGraph } from "@ariadne/core";
import { anthropicChat } from "../src/index";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY가 필요하다.");
  process.exit(1);
}

const question = process.argv[2] ?? "슈퍼스텝(BSP)이 뭔지 두 문장으로 설명해줘.";

const model = anthropicChat({ system: "간결하게 한국어로 답한다.", maxTokens: 1024 });

const g = new StateGraph<MessagesState>(messagesSchema);
g.addNode("model", async (s) => ({ messages: [await model.invoke(s.messages)] }));
g.addEdge(START, "model");
g.addEdge("model", END);

console.log(`[${model.provider}:${model.modelId}] ${question}\n`);

for await (const update of g.compile().stream({ messages: [human(question)] })) {
  console.log(`--- step ${update.step}: ${update.nodes.join(" · ")} ---`);
  for (const msg of update.state.messages) {
    console.log(`  ${msg.role}: ${msg.content}`);
  }
}
