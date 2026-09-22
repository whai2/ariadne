import { expect, test } from "bun:test";
import { ai, START, StateGraph } from "@ariadne/core";
import { TraceCollector, tracedModel, tracedTool, traceRun } from "../src";

test("출력은 원본 그대로 돌려주고 기록은 분리하며 0과 미보고 usage를 구분한다", async () => {
  const collector = new TraceCollector();
  const root = collector.startRun();
  const output = ai("ok", undefined, undefined, { inputTokens: 0, outputTokens: 0 });
  const options = { signal: new AbortController().signal };
  const model = {
    provider: "fake",
    modelId: "fake",
    supportsTools: true,
    async invoke(_messages: unknown[], actual?: typeof options) {
      expect(actual).toBe(options);
      return output;
    },
  };
  const response = await tracedModel(model, root).invoke([], options);
  expect(response).toBe(output);
  output.content = "changed";
  const record = collector.spans().find((s) => s.kind === "model");
  expect(record?.output).toMatchObject({ content: "ok" });
  expect(record?.attributes["gen_ai.usage.input_tokens"]).toBe(0);
  await tracedModel(
    {
      ...model,
      async invoke() {
        return ai("no usage");
      },
    },
    root,
  ).invoke([]);
  expect(collector.spans().at(-1)?.attributes).not.toHaveProperty("gen_ai.usage.input_tokens");
  collector.finishRun(root);
  const copy = collector.spans();
  if (copy[0]) copy[0].name = "changed";
  expect(collector.spans()[0]?.name).toBe("run");
});

test("툴 this·인자·반환값을 보존하며 직렬화 불가능한 값은 실행을 깨지 않는다", async () => {
  const collector = new TraceCollector();
  const root = collector.startRun();
  const circular: { self?: unknown } = {};
  circular.self = circular;
  const ctx = { toolCallId: "call-1" };
  const original = {
    name: "test",
    schema: "schema",
    value: 2,
    execute(input: unknown, actual: typeof ctx) {
      expect(this.value).toBe(2);
      expect(input).toBe(circular);
      expect(actual).toBe(ctx);
      return circular;
    },
  };
  const tool = tracedTool(original, root);
  expect(tool.schema).toBe(original.schema);
  expect(await tool.execute(circular, ctx)).toBe(circular);
  const span = collector.spans().at(-1);
  expect(span?.input).toBe("[unserializable]");
  expect(span?.output).toBe("[unserializable]");
  expect(span?.status).toBe("ok");
  expect(span?.attributes["gen_ai.tool.call.id"]).toBe("call-1");
  collector.finishRun(root);
});

test("종료는 한 번만; 실행 중 clear는 거부하고 완료 후 메모리를 해제한다", () => {
  const collector = new TraceCollector();
  const root = collector.startRun();
  expect(() => collector.clear()).toThrow("실행 중");
  root.end({ output: 1 });
  root.end({ error: { name: "late", message: "late" } });
  expect(collector.spans()[0]?.status).toBe("ok");
  expect(collector.spans()[0]?.output).toBe(1);
  collector.clear();
  expect(collector.spans()).toEqual([]);
});

test("병렬 툴의 조기 실패 뒤 남은 호출은 미완료로 닫고 늦은 결과를 덮어쓰지 않는다", async () => {
  const collector = new TraceCollector();
  const gate = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  await expect(
    traceRun(
      (trace) => {
        const g = new StateGraph<{ n: number }>();
        g.addNode(
          "tools",
          trace.node<{ n: number }>(async (_s, parent) => {
            const bad = tracedTool(
              {
                name: "bad",
                execute() {
                  throw new Error("tool failed");
                },
              },
              parent,
            );
            const slow = tracedTool(
              {
                name: "slow",
                async execute() {
                  await gate.promise;
                  return 42;
                },
              },
              parent,
            );
            const pending = slow.execute().finally(() => settled.resolve());
            await Promise.all([pending, bad.execute()]);
            return {};
          }),
        );
        g.addEdge(START, "tools");
        return g.compile();
      },
      { n: 0 },
      { collector },
    ),
  ).rejects.toThrow("tool failed");
  const before = collector.spans();
  expect(before.every((s) => s.status !== "running")).toBe(true);
  expect(before.find((s) => s.name === "execute_tool slow")?.attributes["ariadne.incomplete"]).toBe(
    true,
  );
  for (const span of before) {
    if (span.parentId !== undefined) {
      expect(before.find((p) => p.spanId === span.parentId)?.endedAt).toBeGreaterThanOrEqual(
        span.endedAt ?? 0,
      );
    }
  }
  gate.resolve();
  await settled.promise;
  expect(collector.spans()).toEqual(before);
});

test("관측 패키지에는 런타임 외부 의존성과 암묵적 컨텍스트가 없다", async () => {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  const root = new URL("../src/", import.meta.url).pathname;
  for (const file of new Bun.Glob("*.ts").scanSync(root)) {
    const source = await Bun.file(`${root}/${file}`).text();
    expect(source).not.toContain("AsyncLocalStorage");
    for (const match of source.matchAll(/^import (.*?) from ["']([^"']+)["']/gm)) {
      const specifier = match[2];
      if (
        specifier !== undefined &&
        !specifier.startsWith(".") &&
        !specifier.startsWith("bun:") &&
        !specifier.startsWith("node:")
      ) {
        expect(match[1]?.startsWith("type ")).toBe(true);
        expect(specifier).toBe("@ariadne/core");
      }
    }
  }
});
