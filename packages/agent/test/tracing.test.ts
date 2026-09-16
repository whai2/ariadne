import { expect, test } from "bun:test";
import { ai, type BaseMessage, human, type MessagesState } from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { TraceCollector, traceRun } from "@ariadne/observability";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { createAgent } from "../src";

const tool = defineTool({
  name: "double",
  description: "double",
  schema: z.object({ n: z.number() }),
  execute: ({ n }) => n * 2,
});
const model: ChatModel = {
  provider: "fake",
  modelId: "react",
  supportsTools: true,
  async invoke(messages) {
    const round = messages.filter((m) => m.role === "tool").length;
    return ai(
      round < 3 ? "" : "done",
      undefined,
      round < 3 ? [{ id: `c${round}`, name: "double", args: { n: round } }] : undefined,
    );
  },
};

test("createAgent trace 옵션: 3라운드의 동작은 그대로이고 각 모델·툴 호출이 node 아래 연결된다", async () => {
  const input: MessagesState = { messages: [human("go")] };
  const plain = await createAgent({ model, tools: [tool] }).invoke(input);
  const collector = new TraceCollector();
  const traced = await traceRun((trace) => createAgent({ model, tools: [tool], trace }), input, {
    collector,
  });
  expect(traced).toEqual(plain);
  const spans = collector.spans();
  expect(spans).toHaveLength(22);
  for (const span of spans.filter((s) => s.kind === "model" || s.kind === "tool")) {
    expect(spans.find((p) => p.spanId === span.parentId)?.kind).toBe("node");
  }
});

test("승인 대기에서는 툴 실행 span이 없고 allow 재개는 새 trace의 tools node 아래 기록한다", async () => {
  let calls = 0;
  const single: ChatModel = {
    ...model,
    async invoke(messages: BaseMessage[]) {
      return messages.some((m) => m.role === "tool")
        ? ai("done")
        : ai("", undefined, [{ id: "one", name: "double", args: { n: 2 } }]);
    },
  };
  const counting = {
    ...tool,
    execute: (...args: Parameters<typeof tool.execute>) => {
      calls++;
      return tool.execute(...args);
    },
  };
  const collector = new TraceCollector();
  const paused = await traceRun(
    (trace) => createAgent({ model: single, tools: [counting], approval: () => "ask", trace }),
    { messages: [human("go")] } as MessagesState,
    { collector, threadId: "same" },
  );
  expect(calls).toBe(0);
  expect(collector.spans().filter((s) => s.kind === "tool")).toHaveLength(0);
  const result = await traceRun(
    (trace) => createAgent({ model: single, tools: [counting], approval: () => "allow", trace }),
    paused,
    { collector, threadId: "same" },
  );
  expect(calls).toBe(1);
  expect(result.messages.at(-1)?.content).toBe("done");
  const roots = collector.spans().filter((s) => s.kind === "run");
  expect(roots).toHaveLength(2);
  const toolSpan = collector.spans().find((s) => s.kind === "tool");
  expect(toolSpan?.traceId).toBe(roots[1]?.traceId);
});
