// 챗봇 그래프에 **아무 프로바이더나** 꽂아보는 데모.
//
//   bun run --filter '@ariadne/model' example anthropic/claude-opus-5 "질문"
//   bun run --filter '@ariadne/model' example openrouter/anthropic/claude-haiku-4.5
//   bun run --filter '@ariadne/model' example groq/llama-3.3-70b-versatile
//   bun run --filter '@ariadne/model' example minimax/MiniMax-M2
//
// 요점: **첫 인자만 바뀐다.** 그래프도, 노드도, 스키마도 그대로다.
// V8 캡스톤에서 가짜 함수였던 model 노드가 그 자리에서 진짜 모델이 됐을 뿐이다.

import { END, human, type MessagesState, messagesSchema, START, StateGraph } from "@ariadne/core";
import { listProviders, model as resolveModel } from "../src/index";

const spec = process.argv[2] ?? "anthropic/claude-opus-5";
const question = process.argv[3] ?? "슈퍼스텝(BSP)이 뭔지 두 문장으로 설명해줘.";

let model: ReturnType<typeof resolveModel>;
try {
  model = resolveModel(spec, { system: "간결하게 한국어로 답한다.", maxTokens: 1024 });
} catch (err) {
  console.error(`${(err as Error).message}\n`);
  console.error(
    `부를 수 있는 프로바이더 ${listProviders("anthropic").length + listProviders("openai").length}개 중 일부:`,
  );
  console.error(
    `  ${["anthropic", "openai", "openrouter", "groq", "deepseek", "xai", "minimax"].join(" · ")}`,
  );
  process.exit(1);
}

const g = new StateGraph<MessagesState>(messagesSchema);
g.addNode("model", async (s) => ({ messages: [await model.invoke(s.messages)] }));
g.addEdge(START, "model");
g.addEdge("model", END);

console.log(`[${model.provider} → ${model.modelId}] ${question}\n`);

for await (const update of g.compile().stream({ messages: [human(question)] })) {
  console.log(`--- step ${update.step}: ${update.nodes.join(" · ")} ---`);
  for (const msg of update.state.messages) {
    console.log(`  ${msg.role}: ${msg.content}`);
  }
}
