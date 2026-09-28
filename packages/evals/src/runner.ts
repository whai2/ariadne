import type { BaseMessage } from "@ariadne/core";
import type { Span } from "@ariadne/observability";
import type { EvalDataset } from "./dataset";

export interface EvalFailure {
  name: string;
  message: string;
}

/** 평가 대상이 한 번 실행된 뒤 내놓는 관측값. 점수는 아직 없다. */
export interface RunObservation {
  messages: BaseMessage[];
  spans: Span[];
  error?: EvalFailure;
}

/** model·agent를 모르는 주입점. 바깥 조립 코드가 실제 대상을 이 함수 모양으로 바꾼다. */
export type EvalTarget<I> = (input: I, context: { caseId: string }) => Promise<RunObservation>;

export interface RunRecord extends RunObservation {
  caseId: string;
  trial: number;
  startedAt: number;
  endedAt: number;
}

interface Job<I> {
  index: number;
  caseId: string;
  input: I;
  trial: number;
}

function assertPositiveInteger(value: number, name: string): void {
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

function jobsFor<I>(dataset: EvalDataset<I, unknown>, trials: number): Job<I>[] {
  const jobs: Job<I>[] = [];
  for (const item of dataset.cases) {
    for (let trial = 0; trial < trials; trial++) {
      jobs.push({ index: jobs.length, caseId: item.id, input: item.input, trial });
    }
  }
  return jobs;
}

async function runJob<I>(job: Job<I>, target: EvalTarget<I>): Promise<RunRecord> {
  const startedAt = Date.now();
  let observation: RunObservation;

  try {
    observation = await target(job.input, { caseId: job.caseId });
  } catch (error) {
    observation = { messages: [], spans: [], error: describeError(error) };
  }

  return {
    caseId: job.caseId,
    trial: job.trial,
    startedAt,
    endedAt: Date.now(),
    messages: observation.messages,
    spans: observation.spans,
    ...(observation.error === undefined ? {} : { error: observation.error }),
  };
}

/** 사례 × trial을 제한된 동시성으로 실행한다. 반환 순서는 완료 시각과 무관하게 데이터셋 순서다. */
export async function runDataset<I>(options: {
  dataset: EvalDataset<I, unknown>;
  target: EvalTarget<I>;
  trials?: number;
  concurrency?: number;
}): Promise<RunRecord[]> {
  const { dataset, target, trials = 1, concurrency = 1 } = options;

  assertPositiveInteger(trials, "trials");
  assertPositiveInteger(concurrency, "concurrency");

  const jobs = jobsFor(dataset, trials);
  const records = new Array<RunRecord>(jobs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (job === undefined) return;
      records[job.index] = await runJob(job, target);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => worker()),
  );
  return records;
}
