# F7.1 — 벤치마크가 들어오고, Claude Code가 같은 Studio에서 돈다

## 1. 이번 단계의 질문

F6까지 한 run의 model·tool·node·superstep을 trace로 남길 수 있었다. 하지만 trace는 관찰일 뿐이다.
여러 입력을 같은 조건으로 반복해서 실행하고 비교할 수 있는 단위가 없었다.

처음 계획은 자체 가짜 툴 데이터셋부터 만드는 것이었다. 실제로 eval을 공부하면서 순서를 바꿨다.
에이전트의 목적·입력 분포·정답을 동시에 발명하면 러너를 배우기 전에 제품 정의에 막힌다. 그래서
첫 데이터는 이미 질문·함수 선언·기대 호출이 고정된 **BFCL**을 쓴다.

이 단계의 완료 조건은 점수가 아니다.

```text
고정 데이터셋
→ 같은 대상을 k회 실행
→ 성공·실패를 빠뜨리지 않고 RunRecord로 보존
→ Studio에서 실제 Claude Code로 실행 결과를 읽는다
```

## 2. `@ariadne/evals`의 경계

패키지는 `agent`와 `model`을 import하지 않는다. 평가 대상은 다음 함수 하나다.

```ts
type EvalTarget<I, S> = (
  input: I,
  context: { caseId: string; trial: number },
) => Promise<{
  steps: StepUpdate<S>[];
  messages: BaseMessage[];
  spans: Span[];
  error?: { name: string; message: string };
}>;
```

러너는 대상이 모델인지, 그래프인지, HTTP 서버인지 모른다. `case × trials` job을 만들고 동시성
상한 안에서 실행한 뒤 입력 순서로 돌려놓는다. 대상이 던져도 행을 버리지 않는다. 빈 관측값과
오류를 같은 `RunRecord`에 남긴다. 실패가 표본에서 사라지면 완료율부터 거짓말이 되기 때문이다.

`report.ts`가 계산하는 것은 `completed`와 `failed`뿐이다. 기대 호출과 실제 호출이 함께 있어도
아직 맞고 틀림을 판정하지 않는다. F7.2의 메트릭이 올라오기 전 숫자를 먼저 만들지 않는 경계다.

## 3. BFCL V4 mini

원본은 Gorilla 저장소 commit `6ea57973c7a6097fd7c5915698c54c17c5b1b6c8`에 고정했다.

- simple JavaScript 6건: 함수를 호출해야 한다.
- irrelevance 6건: 제공된 함수가 질문과 무관하므로 호출하면 안 된다.

원본의 `dict`·`String` 같은 언어별 타입 표기를 JSON Schema의 `object`·`string`으로
정규화했다. 문장과 기대값은 BFCL에서 왔으며 변경 사실·출처·Apache-2.0 전문을
`packages/evals/datasets/`에 함께 둔다. 이것은 공식 전체 BFCL 점수가 아니다. 러너를 연결하는
고정 12건 발췌본이므로 이름도 `bfcl-v4-mini`다.

## 4. Studio에서 실제 에이전트로 바꾸는 어댑터

별도 Claude 실행기를 만들지 않았다. `apps/studio/src/services/evals.ts`가 BFCL 함수 선언을
`AnyTool[]`로 바꾸고 Studio가 이미 쓰는 조립을 그대로 사용한다.

```text
BFCL case
→ model("claude-code/sonnet", { promptedTools: true })
→ createAgent
→ tracedGraph
→ messages + steps + spans
```

BFCL single-turn AST 과제는 **첫 tool call**이 산출물이다. 툴을 실제 실행하면 두 번째 모델 호출과
가짜 툴 결과가 평가를 오염시킨다. 그래서 모든 선언 툴 앞에 `askAlways`를 둔다. 모델이 함수를
고르면 승인 대기 상태로 정상 종료하고, 무관하다고 판단하면 툴 없이 답하고 종료한다. 선언 툴의
`execute`는 호출되지 않는다. 이 모양은 새 중단 장치가 아니라 F3.3 승인 게이트를 평가 하네스로
재사용한 것이다.

서비스의 기본 target만 실제 Claude Code다. 테스트는 `EvalTarget`을 주입해 동일한 suite/run HTTP
경로를 오프라인으로 검증한다. 따라서 전체 `verify`가 새 모델 호출 12회를 몰래 만들지 않는다.
실호출은 Studio의 Evals 화면에서 사람이 [전체 실행]을 누를 때만 시작된다.

## 5. 화면이 말하는 것과 말하지 않는 것

사이드바의 Quality/Evals에서 다음을 본다.

- 고정 dataset·commit·model·case 수
- case별 사용자 입력과 제공 함수
- BFCL의 기대 함수 이름
- Claude Code 실행에서 관측한 함수 이름
- 실행 오류·소요 시간·span 수

화면은 기대와 관측을 나란히 두지만 색으로 정답을 선언하거나 accuracy를 계산하지 않는다. 인자
복수 정답, 병렬 호출 순서, 불필요한 호출을 판정하는 규칙은 F7.2의 일이다. 지금의 `completed`는
과제를 맞혔다는 뜻이 아니라 **실행 기록이 완결됐다**는 뜻이다.

## 6. 검증

- 데이터셋 name/version과 case ID 중복 가드.
- 2 case × k=3 = 6 records, concurrency 상한 2, 완료 역순이어도 반환 순서 고정.
- 대상 예외가 record의 `error`로 남고 report에서 failed로 집계.
- BFCL mini가 simple 6 + irrelevance 6이며 기대 호출 없음이 보존됨.
- Studio GET suite와 POST run이 같은 12건을 반환하고 score 필드가 없음.
- React production build에서 Evals 화면 타입·번들 검증.

`bun run verify` 결과는 **441 pass · 3 skip · 0 fail**이다. Studio에서 실제
`claude-code/sonnet`으로 12건을 실행한 결과도 **completed 12 · errors 0**이었고, 각 record에
관측 tool call과 4~6개 span이 남았다.
