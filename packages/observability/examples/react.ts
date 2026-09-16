import {
  ai,
  END,
  human,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
} from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { defineTool, toolNode, toolSpecs, toolsCondition } from "@ariadne/tools";
import { z } from "zod";
import { type GraphTrace, TraceCollector, tracedModel, tracedTool, traceRun } from "../src";

// 키·네트워크 없이 세 번의 툴 라운드와 최종 답변을 만든다.
const model: ChatModel = {
  provider: "scripted",
  modelId: "three-rounds",
  supportsTools: true,
  async invoke(messages) {
    const round = messages.filter((m) => m.role === "tool").length;
    return ai(
      round === 3 ? "완료" : "",
      undefined,
      round < 3 ? [{ id: `call_${round}`, name: "double", args: { n: round + 1 } }] : undefined,
      { inputTokens: 10, outputTokens: 2 },
    );
  },
};
const double = defineTool({
  name: "double",
  description: "두 배",
  schema: z.object({ n: z.number() }),
  execute: ({ n }) => n * 2,
});

export function buildExample(trace: GraphTrace) {
  const graph = new StateGraph<MessagesState>(messagesSchema);
  graph.addNode(
    "model",
    trace.node<MessagesState>(async (state, parent) => ({
      messages: [
        await tracedModel(model, parent).invoke(state.messages, { tools: toolSpecs([double]) }),
      ],
    })),
  );
  graph.addNode(
    "tools",
    trace.node<MessagesState>((state, parent) => toolNode([tracedTool(double, parent)])(state)),
  );
  graph.addEdge(START, "model");
  graph.addConditionalEdges("model", toolsCondition, ["tools", END]);
  graph.addEdge("tools", "model");
  return graph.compile();
}

if (import.meta.main) {
  const collector = new TraceCollector();
  const state = await traceRun(
    buildExample,
    { messages: [human("세 번 실행해줘")] },
    { collector, threadId: "demo" },
  );
  const root = collector.spans().find((s) => s.kind === "run");
  console.log(state.messages.at(-1)?.content);
  if (root !== undefined) console.log(JSON.stringify(collector.tree(root.traceId), null, 2));
}
