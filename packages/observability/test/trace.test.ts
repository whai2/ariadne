import { expect, test } from "bun:test";
import {
  ai,
  END,
  human,
  InvalidUpdateError,
  NodeExecutionError,
  Send,
  START,
  StateGraph,
  type TaskContext,
} from "@ariadne/core";
import { buildExample } from "../examples/react";
import { type GraphTrace, type Span, TraceCollector, tracedModel, traceRun } from "../src";

function assertClosedTree(spans: Span[]) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  for (const span of spans) {
    expect(span.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(span.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(span.status).not.toBe("running");
    expect(span.endedAt).toBeDefined();
    if (span.parentId !== undefined) {
      const parent = byId.get(span.parentId);
      expect(parent?.traceId).toBe(span.traceId);
      expect(parent?.startedAt).toBeLessThanOrEqual(span.startedAt);
      expect(parent?.endedAt).toBeGreaterThanOrEqual(span.endedAt ?? 0);
    }
  }
}

test("3라운드 ReAct: 실제 model/tools 링과 연결되고 정확한 트리를 만든다", async () => {
  const collector = new TraceCollector();
  const state = await traceRun(
    buildExample,
    { messages: [human("go")] },
    { collector, threadId: "thread-a" },
  );
  expect(state.messages).toHaveLength(8);
  expect(state.messages.at(-1)?.content).toBe("완료");
  const spans = collector.spans();
  expect(spans).toHaveLength(22);
  expect(spans.filter((s) => s.kind === "model")).toHaveLength(4);
  expect(spans.filter((s) => s.kind === "tool")).toHaveLength(3);
  assertClosedTree(spans);
  const root = spans[0];
  if (root === undefined) throw new Error("missing root");
  expect(root.attributes["ariadne.thread.id"]).toBe("thread-a");
  const tree = collector.tree(root.traceId);
  expect(tree?.children).toHaveLength(7);
  for (const step of tree?.children ?? []) {
    expect(step.kind).toBe("superstep");
    expect(step.children).toHaveLength(1);
    const node = step.children[0];
    expect(node?.kind).toBe("node");
    expect(node?.children).toHaveLength(1);
    expect(node?.children[0]?.kind).toBe(node?.name === "model" ? "model" : "tool");
  }
  expect(
    spans
      .filter((s) => s.kind === "model")
      .reduce((n, s) => n + Number(s.attributes["gen_ai.usage.input_tokens"]), 0),
  ).toBe(40);
});

test("동일 이름 Send + 역순 완료 + 두 run 동시 실행에도 부모와 입력이 섞이지 않는다", async () => {
  const collector = new TraceCollector();
  const build = (trace: GraphTrace) => {
    const gate = Promise.withResolvers<void>();
    const graph = new StateGraph<{ values: number[] }>({
      values: { reducer: (a, b) => [...a, ...b] },
    });
    graph.addNode<number>(
      "worker",
      trace.node<{ values: number[] }, number>(async (n, parent) => {
        if (n === 1) await gate.promise;
        const result = await tracedModel(
          {
            provider: "fake",
            modelId: "m",
            supportsTools: false,
            async invoke() {
              if (n === 2) gate.resolve();
              return ai(String(n));
            },
          },
          parent,
        ).invoke([human(String(n))]);
        return { values: [Number(result.content)] };
      }),
    );
    graph.addConditionalEdges(START, () => [new Send("worker", 1), new Send("worker", 2)]);
    graph.addEdge("worker", END);
    return graph.compile();
  };
  const results = await Promise.all([
    traceRun(build, { values: [] }, { collector }),
    traceRun(build, { values: [] }, { collector }),
  ]);
  expect(results).toEqual([{ values: [1, 2] }, { values: [1, 2] }]);
  const roots = collector.spans().filter((s) => s.kind === "run");
  expect(new Set(roots.map((s) => s.traceId)).size).toBe(2);
  for (const root of roots) {
    const spans = collector.spans(root.traceId);
    assertClosedTree(spans);
    const nodes = spans.filter((s) => s.kind === "node");
    expect(nodes.map((s) => s.attributes["ariadne.task.id"])).toEqual(["0:0", "0:1"]);
    for (const [i, node] of nodes.entries()) {
      expect(spans.find((s) => s.parentId === node.spanId)?.input).toEqual([human(String(i + 1))]);
    }
  }
});

test("원래 compiled graph도 변경 없이 관찰하며 실행 context ID는 이벤트와 같다", async () => {
  const g = new StateGraph<{ n: number }>();
  let context: TaskContext | undefined;
  g.addNode("plain", (_s, ctx) => {
    context = ctx;
    return { n: 2 };
  });
  g.addEdge(START, "plain");
  const graph = g.compile();
  const collector = new TraceCollector();
  expect(await traceRun(() => graph, { n: 1 }, { collector })).toEqual(
    await graph.invoke({ n: 1 }),
  );
  expect(Object.isFrozen(context)).toBe(true);
  const node = collector.spans().find((s) => s.kind === "node");
  expect(node?.attributes["ariadne.task.id"]).toBe(context?.id);
  expect(node?.attributes["ariadne.channel.writes"]).toEqual([{ channel: "n", value: 2 }]);
  assertClosedTree(collector.spans());
});

test("모델 오류는 원인 그대로 전파하고 model/node/step/run을 모두 닫는다", async () => {
  const cause = new Error("API 429");
  const collector = new TraceCollector();
  const build = (trace: GraphTrace) => {
    const g = new StateGraph<{ n: number }>();
    g.addNode(
      "model",
      trace.node<{ n: number }>(async (_s, parent) => {
        await tracedModel(
          {
            provider: "fake",
            modelId: "bad",
            supportsTools: false,
            async invoke() {
              throw cause;
            },
          },
          parent,
        ).invoke([]);
        return {};
      }),
    );
    g.addEdge(START, "model");
    return g.compile();
  };
  const thrown = await traceRun(build, { n: 1 }, { collector }).catch((e: unknown) => e);
  expect(thrown).toBeInstanceOf(NodeExecutionError);
  expect((thrown as Error).cause).toBe(cause);
  const spans = collector.spans();
  expect(spans).toHaveLength(4);
  expect(spans.every((s) => s.status === "error")).toBe(true);
  expect(spans.find((s) => s.kind === "node")?.attributes["ariadne.committed"]).toBe(false);
  assertClosedTree(spans);
});

test("writer 오류도 node span에 남고 성공한 model span은 성공을 유지한다", async () => {
  const collector = new TraceCollector();
  await expect(
    traceRun(
      (trace) => {
        const g = new StateGraph<{ n: number }>();
        g.addNode(
          "a",
          trace.node<{ n: number }>(async (_s, parent) => {
            await tracedModel(
              {
                provider: "fake",
                modelId: "ok",
                supportsTools: false,
                async invoke() {
                  return ai("ok");
                },
              },
              parent,
            ).invoke([]);
            return { n: 2 };
          }),
        );
        g.addEdge(START, "a");
        g.addConditionalEdges("a", () => {
          throw new Error("bad route");
        });
        return g.compile();
      },
      { n: 1 },
      { collector },
    ),
  ).rejects.toThrow("bad route");
  const spans = collector.spans();
  expect(spans.find((s) => s.kind === "model")?.status).toBe("ok");
  expect(spans.find((s) => s.kind === "node")?.error?.message).toBe("bad route");
  assertClosedTree(spans);
});

test("리듀서 충돌은 원래 예외 타입을 보존하고 열린 span을 남기지 않는다", async () => {
  const collector = new TraceCollector();
  await expect(
    traceRun(
      (trace) => {
        const g = new StateGraph<{ n: number }>();
        g.addNode(
          "a",
          trace.node<{ n: number }>(() => ({ n: 2 })),
        );
        g.addNode(
          "b",
          trace.node<{ n: number }>(() => ({ n: 3 })),
        );
        g.addEdge(START, "a");
        g.addEdge(START, "b");
        return g.compile();
      },
      { n: 1 },
      { collector },
    ),
  ).rejects.toBeInstanceOf(InvalidUpdateError);
  assertClosedTree(collector.spans());
  expect(
    collector
      .spans()
      .filter((s) => s.kind === "node")
      .every((s) => s.attributes["ariadne.committed"] === false),
  ).toBe(true);
});

test("0스텝, 빌드 실패, 입력 실패도 run 기록을 남긴다", async () => {
  const collector = new TraceCollector();
  const empty = new StateGraph<{ n: number }>();
  empty.addEdge(START, END);
  expect(await traceRun(() => empty.compile(), { n: 1 }, { collector })).toEqual({ n: 1 });
  const error = new Error("build");
  await expect(
    traceRun(
      () => {
        throw error;
      },
      {},
      { collector },
    ),
  ).rejects.toBe(error);
  const bad = new StateGraph<{ n: number }>({
    n: {
      reducer: () => {
        throw new Error("input");
      },
    },
  });
  bad.addEdge(START, END);
  await expect(
    traceRun(() => bad.compile(), { n: 2 }, { collector, checkpoint: { n: 1 } }),
  ).rejects.toThrow("input");
  expect(collector.spans().map((s) => s.status)).toEqual(["ok", "error", "error"]);
  assertClosedTree(collector.spans());
});

test("체크포인트 복원 옵션을 전달하고 thread는 여러 trace를 묶는다", async () => {
  const collector = new TraceCollector();
  const g = new StateGraph<{ n: number }>({ n: { reducer: (a, b) => a + b } });
  g.addNode("add", () => ({ n: 1 }));
  g.addEdge(START, "add");
  for (let i = 0; i < 2; i++)
    expect(
      await traceRun(
        () => g.compile(),
        { n: 2 },
        { collector, threadId: "same", checkpoint: { n: 10 } },
      ),
    ).toEqual({ n: 13 });
  const roots = collector.spans().filter((s) => s.kind === "run");
  expect(new Set(roots.map((s) => s.traceId)).size).toBe(2);
  expect(roots.every((s) => s.attributes["ariadne.thread.id"] === "same")).toBe(true);
});
