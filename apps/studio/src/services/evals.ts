import { askAlways, createAgent } from "@ariadne/agent";
import { type BaseMessage, human } from "@ariadne/core";
import {
  BFCL_V4_MINI,
  type BfclInput,
  buildReport,
  type EvalTarget,
  runDataset,
} from "@ariadne/evals";
import { model } from "@ariadne/model";
import { TraceCollector, tracedGraph } from "@ariadne/observability";
import type { AnyTool } from "@ariadne/tools";
import { z } from "zod";
import type { EvalService } from "./types";

const MODEL_ID = "claude-code/sonnet";

export interface EvalServiceOptions {
  target?: EvalTarget<BfclInput>;
  trials?: number;
  concurrency?: number;
}

function describeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

/** BFCL 선언은 실행되지 않는다. askAlways가 첫 tool call 앞에서 멈춰 선택 결과만 보존한다. */
function toolStubsFor(input: BfclInput): AnyTool[] {
  return input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: z.object({}).passthrough(),
    spec: tool,
    execute() {
      throw new Error("BFCL 선언 툴은 실행하지 않는다.");
    },
  }));
}

/** Studio가 이미 사용하는 createAgent + trace 경로를 BFCL 입력 함수로 좁힌다. */
export function claudeCodeBfclTarget(): EvalTarget<BfclInput> {
  const claude = model(MODEL_ID, { promptedTools: true });
  return async (input, context) => {
    const collector = new TraceCollector();
    let messages: BaseMessage[] = input.messages.map((message) => human(message.content));
    try {
      const graph = tracedGraph(
        (trace) =>
          createAgent({
            model: claude,
            tools: toolStubsFor(input),
            approval: askAlways,
            maxToolRounds: 1,
            trace,
          }),
        { collector, name: `eval ${context.caseId}` },
      );
      const stream = graph.stream({ messages });
      let next = await stream.next();
      while (!next.done) {
        next = await stream.next();
      }
      messages = next.value.messages;
      return { messages, spans: collector.spans() };
    } catch (error) {
      return { messages, spans: collector.spans(), error: describeError(error) };
    }
  };
}

export function createEvalService(options: EvalServiceOptions = {}): EvalService {
  const target = options.target ?? claudeCodeBfclTarget();
  return {
    suite: () => ({
      name: BFCL_V4_MINI.name,
      version: BFCL_V4_MINI.version,
      model: MODEL_ID,
      cases: BFCL_V4_MINI.cases.map((item) => ({
        id: item.id,
        prompt: item.input.messages.map((message) => message.content).join("\n"),
        tools: item.input.tools.map((tool) => tool.name),
        expectedTools: item.expected?.calls.map((call) => call.name) ?? [],
      })),
    }),
    async run() {
      const records = await runDataset({
        dataset: BFCL_V4_MINI,
        target,
        trials: options.trials ?? 1,
        concurrency: options.concurrency ?? 2,
      });
      return buildReport({ caseCount: BFCL_V4_MINI.cases.length, records });
    },
  };
}
