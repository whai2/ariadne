import { expect, test } from "bun:test";
import { END, NodeExecutionError, Send, START, StateGraph } from "../src";

test("병렬 쓰기는 완료 순서와 무관하게 태스크에 귀속되고 제어 쓰기는 제외된다", async () => {
  const gate = Promise.withResolvers<void>();
  const finished: string[] = [];
  const g = new StateGraph<{ n: number }>({ n: { reducer: (a, b) => a + b } });
  g.addNode("a", async () => {
    await gate.promise;
    finished.push("a");
    return { n: 2 };
  });
  g.addNode("b", () => {
    finished.push("b");
    gate.resolve();
    return { n: 3 };
  });
  g.addEdge(START, "a");
  g.addEdge(START, "b");
  g.addEdge("a", END);
  g.addEdge("b", END);
  const stream = g.compile().stream({ n: 10 });
  const r = await stream.next();
  if (r.done) throw new Error("missing step");
  expect(finished).toEqual(["b", "a"]);
  expect(r.value.committed).toBe(true);
  expect(r.value.state).toEqual({ n: 15 });
  expect(r.value.tasks.map((t) => [t.id, t.name, t.writes])).toEqual([
    ["0:0", "a", [{ channel: "n", value: 2 }]],
    ["0:1", "b", [{ channel: "n", value: 3 }]],
  ]);
  for (const task of r.value.tasks) {
    expect(task.startedAt).toBeGreaterThan(0);
    expect(task.endedAt).toBeGreaterThanOrEqual(task.startedAt);
    expect(task).not.toHaveProperty("error");
  }
  expect((await stream.next()).done).toBe(true);
});

test("동일 노드 Send도 실행마다 다른 id를 가진다", async () => {
  const g = new StateGraph<{ n: number }>({ n: { reducer: (a, b) => a + b } });
  g.addNode<number>("worker", (n) => ({ n }));
  g.addConditionalEdges(START, () => [new Send("worker", 2), new Send("worker", 3)]);
  g.addEdge("worker", END);
  for await (const step of g.compile().stream({ n: 0 })) {
    expect(step.nodes).toEqual(["worker", "worker"]);
    expect(step.tasks.map((t) => t.id)).toEqual(["0:0", "0:1"]);
    expect(step.tasks.map((t) => t.writes[0]?.value)).toEqual([2, 3]);
  }
});

test("실패 스텝도 형제 완료 후 yield → 다음 next에서 원인과 함께 throw; 쓰기는 미반영", async () => {
  const cause = new TypeError("broken");
  const gate = Promise.withResolvers<void>();
  const g = new StateGraph<{ n: number }>({ n: { reducer: (a, b) => a + b } });
  g.addNode("bad", () => {
    gate.resolve();
    throw cause;
  });
  g.addNode("good", async () => {
    await gate.promise;
    return { n: 99 };
  });
  g.addEdge(START, "bad");
  g.addEdge(START, "good");
  const graph = g.compile();
  const stream = graph.stream({ n: 1 });
  const r = await stream.next();
  if (r.done) throw new Error("missing failed step");
  expect(r.value.committed).toBe(false);
  expect(r.value.state).toEqual({ n: 1 });
  expect(r.value.checkpoint).toEqual({ n: 1 });
  expect(r.value.tasks[0]?.error).toEqual({ name: "TypeError", message: "broken" });
  expect(r.value.tasks[1]?.writes).toEqual([{ channel: "n", value: 99 }]);
  expect(r.value.tasks[1]).not.toHaveProperty("error");
  const error = await stream.next().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NodeExecutionError);
  expect(error).toMatchObject({ node: "bad", step: 0, taskId: "0:0", cause });
  await expect(graph.invoke({ n: 1 })).rejects.toBeInstanceOf(NodeExecutionError);
});

test("writer 실패는 이미 버퍼한 쓰기도 관찰시키며 모든 실패 태스크를 보존한다", async () => {
  const g = new StateGraph<{ n: number }>({ n: { reducer: (a, b) => a + b } });
  g.addNode("route", () => ({ n: 5 }));
  g.addConditionalEdges("route", () => {
    throw new Error("router failed");
  });
  g.addNode("other", async () => {
    throw "non-error";
  });
  g.addEdge(START, "route");
  g.addEdge(START, "other");
  const stream = g.compile().stream({ n: 1 });
  const r = await stream.next();
  if (r.done) throw new Error("missing failed step");
  expect(r.value.tasks.find((t) => t.name === "route")?.writes).toEqual([
    { channel: "n", value: 5 },
  ]);
  expect(r.value.tasks.map((t) => t.error?.message)).toEqual(["non-error", "router failed"]);
  expect(r.value.state).toEqual({ n: 1 });
  await expect(stream.next()).rejects.toThrow("non-error");
});
