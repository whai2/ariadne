/** 평가 입력 하나. `expected`는 러너가 해석하지 않고 다음 단계의 채점자에게 전달한다. */
export interface EvalCase<I = unknown, E = unknown> {
  id: string;
  input: I;
  expected?: E;
  rubric?: string;
  tags?: readonly string[];
}

/** 같은 이름과 버전 아래 순서가 고정된 평가 사례 묶음. */
export interface EvalDataset<I = unknown, E = unknown> {
  name: string;
  version: string;
  cases: readonly EvalCase<I, E>[];
}

/** 중복 ID는 실행 기록을 서로 구별할 수 없게 하므로 데이터셋을 만드는 경계에서 거절한다. */
export function defineDataset<I, E>(dataset: EvalDataset<I, E>): EvalDataset<I, E> {
  if (dataset.name.trim() === "" || dataset.version.trim() === "") {
    throw new Error("데이터셋 name과 version이 필요하다.");
  }

  const ids = new Set<string>();

  for (const item of dataset.cases) {
    if (item.id.trim() === "") throw new Error("평가 사례 id가 필요하다.");
    if (ids.has(item.id)) throw new Error(`평가 사례 id가 중복됐다: ${item.id}`);

    ids.add(item.id);
  }

  return dataset;
}
