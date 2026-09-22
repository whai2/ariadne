import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { human, START, StateGraph } from "@ariadne/core";
import { TraceCollector, TraceStore, traceRun } from "../src";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function recorded(threadId: string, fail = false) {
  const collector = new TraceCollector();
  const graph = new StateGraph<{ messages: ReturnType<typeof human>[] }>({
    messages: { reducer: (a, b) => [...a, ...b] },
  });
  graph.addNode("model", () => {
    if (fail) throw new Error("broken");
    return {};
  });
  graph.addEdge(START, "model");
  await traceRun(() => graph.compile(), { messages: [human("hi")] }, { collector, threadId }).catch(
    () => undefined,
  );
  return collector.spans();
}

test("완료된 성공·실패 trace를 thread별로 저장하고 재시작 뒤에도 읽는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ariadne-traces-"));
  dirs.push(dir);
  const path = join(dir, "traces.sqlite");
  const first = TraceStore.open(path);
  first.put(await recorded("a"));
  first.put(await recorded("a", true));
  first.put(await recorded("b"));
  expect(
    first
      .list("a")
      .map((trace) => trace.status)
      .sort(),
  ).toEqual(["error", "ok"]);
  expect(first.list("b")).toHaveLength(1);
  first.close();

  const reopened = TraceStore.open(path);
  const traces = reopened.list("a");
  expect(traces).toHaveLength(2);
  expect(traces.every((trace) => trace.spans.every((span) => span.status !== "running"))).toBe(
    true,
  );
  reopened.close();
});

test("실행 중이거나 서로 다른 trace가 섞인 목록은 저장하지 않는다", async () => {
  const store = TraceStore.open();
  const open = new TraceCollector();
  open.startRun();
  expect(() => store.put(open.spans())).toThrow("실행 중인 trace");
  const mixed = [...(await recorded("a")), ...(await recorded("b"))];
  expect(() => store.put(mixed)).toThrow("한 trace");
  expect(() => store.list("a", -1)).toThrow("0 이상의 안전한 정수");
  store.close();
});
