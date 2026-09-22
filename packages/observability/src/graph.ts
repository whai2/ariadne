import type {
  CompiledGraph,
  NodeFn,
  NodeReturn,
  StepUpdate,
  StreamOptions,
  TaskContext,
} from "@ariadne/core";
import type { TraceCollector } from "./collector";
import { describeError, type SpanContext, type TraceError } from "./span";

/** run마다 만들어진다. task id는 run 안에서만 유일하므로 전역 맵에 넣지 않는다. */
export class GraphTrace {
  private readonly steps = new Map<number, SpanContext>();
  private readonly tasks = new Map<string, SpanContext>();
  constructor(readonly root: SpanContext) {}

  private step(index: number, startedAt: number): SpanContext {
    let span = this.steps.get(index);
    if (span === undefined) {
      span = this.root.child({
        kind: "superstep",
        name: `superstep ${index}`,
        startedAt,
        attributes: { "ariadne.superstep": index },
      });
      this.steps.set(index, span);
    }
    span.startAt(startedAt);
    return span;
  }
  private task(context: TaskContext): SpanContext {
    let span = this.tasks.get(context.id);
    if (span === undefined) {
      span = this.step(context.step, context.startedAt).child({
        kind: "node",
        name: context.name,
        startedAt: context.startedAt,
        attributes: { "ariadne.node": context.name, "ariadne.task.id": context.id },
      });
      this.tasks.set(context.id, span);
    }
    return span;
  }
  /** fn의 두 번째 인자는 trace 부모. 엔진이 준 task context는 래퍼가 소비한다. */
  node<S, I = S>(
    fn: (input: I, parent: SpanContext) => NodeReturn<S> | Promise<NodeReturn<S>>,
  ): NodeFn<S, I> {
    return (input, context) => {
      if (context === undefined)
        throw new Error("trace.node는 compiled graph 안에서 실행해야 한다.");
      return fn(input, this.task(context));
    };
  }
  /** writer 결과까지 나온 뒤 node를 닫는다. 래핑하지 않은 노드도 여기서 수집된다. */
  observe<S>(update: StepUpdate<S>): void {
    const start = Math.min(...update.tasks.map((t) => t.startedAt));
    const end = Math.max(...update.tasks.map((t) => t.endedAt));
    const step = this.step(update.step, start);
    for (const task of update.tasks) {
      this.task({ ...task, step: update.step }).end({
        endedAt: task.endedAt,
        attributes: {
          "ariadne.channel.writes": task.writes,
          "ariadne.committed": update.committed,
        },
        ...(task.error === undefined ? {} : { error: task.error }),
      });
    }
    const error = update.tasks.find((t) => t.error !== undefined)?.error;
    step.end({
      endedAt: end,
      attributes: { "ariadne.committed": update.committed },
      ...(error === undefined ? {} : { error }),
    });
  }
  /** applyWrites처럼 StepUpdate 이전에 던지는 오류도 열린 step/node에 남긴다. */
  fail(error: TraceError): void {
    for (const step of this.steps.values())
      if (step.isOpen) step.set({ "ariadne.committed": false });
    for (const task of this.tasks.values())
      if (task.isOpen) task.set({ "ariadne.committed": false, "ariadne.step.error": error });
  }
}

export interface TraceRunOptions extends StreamOptions {
  collector: TraceCollector;
  threadId?: string;
  name?: string;
}

export type TraceGraphOptions = Omit<TraceRunOptions, "checkpoint">;

/**
 * 관측 가능한 graph 모양을 만든다. 실행을 소비하지 않으므로 체크포인터 같은 바깥 실행 래퍼와
 * 조합할 수 있다. 호출마다 새 root/GraphTrace를 만들고 성공·실패 모두 닫는다.
 */
export function tracedGraph<S extends object>(
  build: (trace: GraphTrace) => Pick<CompiledGraph<S>, "stream">,
  options: TraceGraphOptions,
): Pick<CompiledGraph<S>, "stream"> {
  return {
    async *stream(input, streamOptions) {
      const root = options.collector.startRun(
        options.name ?? "run",
        options.threadId === undefined ? {} : { "ariadne.thread.id": options.threadId },
        input,
      );
      const trace = new GraphTrace(root);
      try {
        const stream = build(trace).stream(input, streamOptions);
        let result = await stream.next();
        while (!result.done) {
          trace.observe(result.value);
          yield result.value;
          result = await stream.next();
        }
        options.collector.finishRun(root, result.value);
        return result.value;
      } catch (error) {
        const summary = describeError(error);
        trace.fail(summary);
        options.collector.finishRun(root, undefined, summary);
        throw error;
      }
    },
  };
}

/** 입력/반환/예외는 그래프 계약 그대로. 실패 trace도 전달받은 collector에서 조회한다. */
export async function traceRun<S extends object>(
  build: (trace: GraphTrace) => Pick<CompiledGraph<S>, "stream">,
  input: S,
  options: TraceRunOptions,
): Promise<S> {
  const graph = tracedGraph(build, options);
  const stream = graph.stream(
    input,
    options.checkpoint === undefined ? undefined : { checkpoint: options.checkpoint },
  );
  let result = await stream.next();
  while (!result.done) result = await stream.next();
  return result.value;
}
