import type { EvalDataset } from "./dataset";
import type { RunRecord } from "./runner";

/** F7.1의 성적표는 실행 완결성만 요약한다. 성공 점수와 메트릭은 아직 만들지 않는다. */
export interface EvalReport<I = unknown, E = unknown, S extends object = object> {
  dataset: string;
  version: string;
  caseCount: number;
  trialCount: number;
  completed: number;
  failed: number;
  startedAt?: number;
  endedAt?: number;
  records: RunRecord<I, E, S>[];
}

export function buildReport<I, E, S extends object>(
  dataset: EvalDataset<I, E>,
  records: RunRecord<I, E, S>[],
): EvalReport<I, E, S> {
  const times = records.flatMap((record) => [record.startedAt, record.endedAt]);
  return {
    dataset: dataset.name,
    version: dataset.version,
    caseCount: dataset.cases.length,
    trialCount: records.length,
    completed: records.filter((record) => record.error === undefined).length,
    failed: records.filter((record) => record.error !== undefined).length,
    ...(times.length === 0 ? {} : { startedAt: Math.min(...times), endedAt: Math.max(...times) }),
    records,
  };
}
