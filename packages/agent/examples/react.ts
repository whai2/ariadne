// 에이전트 링 데모 — **자격증명 0, 네트워크 0.**
//
//   bun run --filter '@ariadne/agent' example
//
// 모델이 가짜인 게 요점이다(F2.2 tools 데모와 같은 이유). 여기서 볼 건 모델의 똑똑함이 아니라
// **createAgent가 접은 ReAct 루프가 진짜로 돈다는 것**이라, 결정론적이어야 관찰이 된다.
// 진짜 모델로 도는 건 apps/studio의 Chat 탭(tools 모양)이 맡는다.
//
// 두 장면:
//   1. 툴이 있는 에이전트 — 한 턴에 add·multiply 둘 → toolNode 병렬 실행 → 모델이 정리
//   2. 툴이 없는 에이전트 — 같은 createAgent가 단발 호출(START→model→END)로 접힌다

import {
  type AIMessage,
  ai,
  type BaseMessage,
  human,
  isAIMessage,
  isToolMessage,
  type MessagesState,
} from "@ariadne/core";
import type { ChatModel, ChatOptions } from "@ariadne/model";
import { add, multiply } from "@ariadne/tools";
import { createAgent } from "../src/index";

/**
 * 대본 없는 가짜 모델. **상태를 안 들고 messages만 보고 정한다**(스튜디오가 컴파일 그래프를
 * 캐시해 여러 번 돌리므로 클로저 카운터를 두면 두 번째 run이 다르게 굴러버린다 — F2.3의 교훈).
 * 툴 결과가 아직 없으면 add·multiply를 한 턴에 부르고, 있으면 정리해서 답한다.
 */
const fakeModel: ChatModel = {
  provider: "fake",
  modelId: "calc",
  supportsTools: true,
  async invoke(messages: BaseMessage[], _options?: ChatOptions): Promise<AIMessage> {
    const results = messages.filter(isToolMessage);
    if (results.length > 0) {
      return ai(`계산 결과: ${results.map((m) => m.content).join(" · ")}`);
    }
    return ai("", undefined, [
      { id: "call_1", name: "add", args: { a: 3, b: 4 } },
      { id: "call_2", name: "multiply", args: { a: 5, b: 6 } },
    ]);
  },
};

/** 대화 한 줄씩 찍기. 호출은 `toolCalls`에, 결과는 `content`에 있다. */
function dump(messages: BaseMessage[]) {
  for (const msg of messages) {
    const calls = isAIMessage(msg) ? (msg.toolCalls ?? []) : [];
    const label = calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ");
    console.log(`  ${msg.role}: ${msg.content}${label === "" ? "" : ` 🔧 ${label}`}`);
  }
}

async function run(title: string, agent: ReturnType<typeof createAgent>, input: MessagesState) {
  console.log(`━━━ ${title} ━━━`);
  let final: MessagesState = { messages: [] };
  for await (const step of agent.stream(input)) {
    console.log(`  step ${step.step}: ${step.nodes.join(" · ")}`);
    final = step.state;
  }
  dump(final.messages);
  console.log();
}

// 1. 툴이 있는 에이전트 — 네 줄짜리 ReAct가 createAgent 한 줄로 접혔다.
await run(
  "장면 1 · 툴 에이전트 (model ⇄ tools)",
  createAgent({ model: fakeModel, tools: [add, multiply] }),
  {
    messages: [human("3+4랑 5×6 계산해줘")],
  },
);

// 2. 툴이 없는 에이전트 — 같은 함수가 단발 호출로 접힌다(tools 노드도 조건부 엣지도 안 짓는다).
const plainModel: ChatModel = {
  provider: "fake",
  modelId: "chat",
  supportsTools: true,
  async invoke(): Promise<AIMessage> {
    return ai("툴 없이 바로 답한다.");
  },
};
await run("장면 2 · 툴 없는 에이전트 (단발 호출)", createAgent({ model: plainModel }), {
  messages: [human("아무거나 답해")],
});
