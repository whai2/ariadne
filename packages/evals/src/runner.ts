import type { BaseMessage, StepUpdate } from "@ariadne/core";
import type { Span } from "@ariadne/observability";
import type { EvalCase, EvalDataset } from "./dataset";

export interface EvalFailure {
  name: string;
  message: string;
}

/** 평가 대상이 한 번 실행된 뒤 내놓는 관측값. 점수는 아직 없다. */
export interface RunObservation<S extends object = object> {
  steps: StepUpdate<S>[];
  messages: BaseMessage[];
  spans: Span[];
  error?: EvalFailure;
}

export interface EvalTargetContext {
  caseId: string;
  trial: number;
}

/** model·agent를 모르는 주입점. 바깥 조립 코드가 실제 대상을 이 함수 모양으로 바꾼다. */
export type EvalTarget<I, S extends object = object> = (
  input: I,
  context: EvalTargetContext,
) => Promise<RunObservation<S>>;

export interface RunRecord<I = unknown, E = unknown, S extends object = object>
  extends RunObservation<S> {
  caseId: string;
  trial: number;
  input: I;
  expected?: E;
  tags: readonly string[];
  startedAt: number;
  endedAt: number;
}

export interface RunDatasetOptions<I, E, S extends object> {
  dataset: EvalDataset<I, E>;
  target: EvalTarget<I, S>;
  trials?: number;
  concurrency?: number;
  now?: () => number;
}

interface Job<I, E> {
  index: number;
  item: EvalCase<I, E>;
  trial: number;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name}은 1 이상의 안전한 정수여야 한다.`);
  }
}

function describeError(error: unknown): EvalFailure {
  try {
    return error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "Error", message: String(error) };
  } catch {
    return { name: "Error", message: "[unserializable error]" };
  }
}

/** 사례 × trial을 제한된 동시성으로 실행한다. 반환 순서는 완료 시각과 무관하게 데이터셋 순서다. */
export async function runDataset<I, E, S extends object = object>(
  options: RunDatasetOptions<I, E, S>,
): Promise<RunRecord<I, E, S>[]> {
  const trials = options.trials ?? 1;
  const concurrency = options.concurrency ?? 1;
  positiveInteger(trials, "trials");
  positiveInteger(concurrency, "concurrency");
  const now = options.now ?? Date.now;

  const jobs: Job<I, E>[] = [];
  for (const item of options.dataset.cases) {
    for (let trial = 0; trial < trials; trial++) {
      jobs.push({ index: jobs.length, item, trial });
    }
  }
  const records = new Array<RunRecord<I, E, S>>(jobs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (job === undefined) return;
      const startedAt = now();
      let observation: RunObservation<S>;
      try {
        observation = await options.target(job.item.input, {
          caseId: job.item.id,
          trial: job.trial,
        });
      } catch (error) {
        observation = { steps: [], messages: [], spans: [], error: describeError(error) };
      }
      records[job.index] = {
        caseId: job.item.id,
        trial: job.trial,
        input: job.item.input,
        ...(job.item.expected === undefined ? {} : { expected: job.item.expected }),
        tags: job.item.tags ?? [],
        startedAt,
        endedAt: now(),
        steps: observation.steps,
        messages: observation.messages,
        spans: observation.spans,
        ...(observation.error === undefined ? {} : { error: observation.error }),
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => worker()),
  );
  return records;
}
