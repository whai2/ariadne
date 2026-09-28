import type { RunRecord } from "./runner";

/** F7.1의 성적표는 실행 완결성만 요약한다. 성공 점수와 메트릭은 아직 만들지 않는다. */
export interface EvalReport {
  caseCount: number;
  trialCount: number;
  completed: number;
  failed: number;
  records: RunRecord[];
}

export function buildReport({
  caseCount,
  records,
}: {
  caseCount: number;
  records: RunRecord[];
}): EvalReport {
  return {
    caseCount,
    trialCount: records.length,
    completed: records.filter((record) => record.error === undefined).length,
    failed: records.filter((record) => record.error !== undefined).length,
    records,
  };
}
