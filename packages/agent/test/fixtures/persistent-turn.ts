import { ai, human, isToolMessage, type MessagesState, messagesSchema } from "@ariadne/core";
import { MemoryStore } from "@ariadne/memory";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { type Approval, createAgent, pendingToolCalls, runWithCheckpoint } from "../../src/index";

interface State extends MessagesState {
  plan: string;
  budget: number;
}
const input = JSON.parse(process.argv[2] ?? "{}") as {
  path: string;
  threadId: string;
  decision?: Approval;
  hold?: boolean;
};
const ran: string[] = [];
const order: string[] = [];
const agent = createAgent<State>({
  schema: { ...messagesSchema, plan: {}, budget: { reducer: (a, b) => a + b } },
  approval: () => input.decision ?? "ask",
  model: {
    provider: "fake",
    modelId: "test",
    supportsTools: true,
    async invoke(messages) {
      order.push("model");
      return messages.some(isToolMessage)
        ? ai("done")
        : ai("", undefined, [{ id: "c1", name: "rm", args: { path: "a.txt" } }]);
    },
  },
  tools: [
    defineTool({
      name: "rm",
      description: "기록만 하는 테스트 도구",
      schema: z.object({ path: z.string() }),
      execute: ({ path }) => {
        order.push("tool");
        ran.push(path);
        return path;
      },
    }),
  ],
});
const store = MemoryStore.open(input.path);
const state = await runWithCheckpoint(
  agent,
  input.threadId,
  input.decision === undefined
    ? { messages: [human("지워")], plan: "delete a.txt", budget: 5 }
    : {},
  store,
);
process.stdout.write(
  `${JSON.stringify({ state, ran, order, pending: pendingToolCalls(state.messages) })}\n`,
);
// 저장 직후 강제 종료를 테스트한다. DB를 닫지 않아도 커밋된 정지점은 살아야 한다.
if (input.hold) await new Promise(() => setInterval(() => {}, 1000));
store.close();
