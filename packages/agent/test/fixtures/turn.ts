// 한 프로세스 = 한 턴 (F5.1).
//
// `approval.test.ts`는 한 프로세스 안에서 `createAgent`를 두 번 불러 재개를 확인하는데,
// 그 둘은 **메모리를 공유한다** — 툴의 기록 배열 같은 모듈 변수가 살아 있다. 무언가가
// 거기 남아 재개를 은근히 돕고 있어도 알 방법이 없다. 그래서 이 스크립트는 턴 하나만
// 돌고 죽는다. 두 턴 사이에 오가는 건 **JSON 문자열 하나뿐**이다.
//
// 사용법: `bun run turn.ts '{"history":[...],"decision":"allow"}'`
//
// stdout은 **JSON 전용 통로**다 — 로그 한 줄이 섞이면 부모의 파싱이 깨진다.
// (mcp의 stdio 픽스처와 같은 규약.)

import { type AIMessage, ai, type BaseMessage, isToolMessage } from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { type Approval, askAlways, createAgent, pendingToolCalls } from "../../src/index";

interface Input {
  history: BaseMessage[];
  decision?: Approval;
}

/** 이 프로세스 안에서만 유효한 관찰 — 자식은 **자기가 돌린 것만** 증언한다. */
const ran: string[] = [];

const rm = defineTool({
  name: "rm",
  description: "파일을 지운다(데모라 배열에 이름만 남긴다).",
  schema: z.object({ path: z.string() }),
  execute: ({ path }) => {
    ran.push(path);
    return `rm:${path}`;
  },
});

const CALL = [{ id: "c1", name: "rm", args: { path: "a.txt" } }];

/** 툴 결과가 없으면 호출하고, 있으면 산문으로 답한다. **이력만 보고 결정론적으로.** */
const model: ChatModel = {
  provider: "fake",
  modelId: "test",
  supportsTools: true,
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    return messages.some(isToolMessage) ? ai("done") : ai("", undefined, CALL);
  },
};

const raw = process.argv[2];
if (raw === undefined) {
  process.stderr.write("turn.ts: 입력 JSON이 없다\n");
  process.exit(2);
}
const input = JSON.parse(raw) as Input;

// 에이전트를 **새로 세운다.** 이 프로세스는 이전 턴에 대해 아무것도 모른다.
const agent = createAgent({
  model,
  tools: [rm],
  approval: input.decision === undefined ? askAlways : () => input.decision as Approval,
});

const steps: string[][] = [];
let messages = input.history;
for await (const step of agent.stream({ messages: input.history })) {
  steps.push(step.nodes);
  messages = step.state.messages;
}

process.stdout.write(
  `${JSON.stringify({ messages, steps, pending: pendingToolCalls(messages), ran })}\n`,
);
