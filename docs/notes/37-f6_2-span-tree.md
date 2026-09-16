# F6.2 · 자체 스팬 트리와 메모리 수집기

F6.1은 태스크 실행 시간·쓰기·오류를 `StepUpdate.tasks`로 제공했다. 이번 단계는 이를 **run → superstep → node → model/tool** 트리로 연결한다. `@ariadne/observability`는 외부 런타임 의존성 없이 ID 생성, 부모 전달, 기록 수집과 조회를 담당한다.

목표는 Ariadne 자체 트레이싱 인프라다. Langfuse·Mastra는 참고 구현이며 외부 전송을 구현하지 않는다. 이번 저장소는 **명시적으로 생성한 TraceCollector의 메모리**다. 영구 저장·조회 API·Studio 트레이스 UI는 다음 작업이다.

## 1. 왜 실행 전에 ID를 전달해야 하나

완료된 StepUpdate만으로 node 스팬은 만들 수 있다. 하지만 모델 호출이 실행 중일 때 그 부모를 알아야 model 스팬을 만들 수 있다. 같은 이름의 Send 두 개, 서로 겹치는 실행 시간, 같은 모델 객체를 공유하는 두 run은 이름이나 시간으로 구분할 수 없다.

엔진은 이미 runTask에서 `step:index` ID를 만들고 있다. 그 사실을 **읽기 전용 TaskContext**로 노드 함수의 두 번째 인자에 전달하도록 확장했다.

```ts
interface TaskContext {
  readonly id: string;
  readonly name: string;
  readonly step: number;
  readonly startedAt: number;
}
```

이 객체는 엔진에서 freeze하며, 뒤에 나오는 TaskUpdate의 ID와 정확히 같다. trace ID·span 객체·callback은 core에 들어가지 않는다. 상태 채널이나 체크포인트에도 섞지 않는다. 기존 한 인자 함수는 그대로 동작하고, toolNode처럼 함수를 직접 호출하는 경우에는 context를 생략할 수 있다.

`trace.node(fn)`는 이 문맥을 받고 **본문 실행 전에** node 스팬과 superstep 부모를 확보한다. 사용자 함수에는 그 node의 SpanContext를 넘긴다. 본문이 끝났다고 바로 node를 닫지는 않는다. writer의 실패도 노드 실행 결과이므로 최종 StepUpdate가 왔을 때 쓰기·반영 여부·오류를 추가하고 닫는다.

Python 참고: `langgraph/pregel/_algo.py`의 task ID 및 task별 config/metadata 구성. 우리는 중첩 config를 옮기지 않고 실행 식별 사실 네 개만 전달한다.

## 2. 실행별 소유권과 사용법

```ts
import { createAgent } from "@ariadne/agent";
import { TraceCollector, traceRun } from "@ariadne/observability";

const collector = new TraceCollector();
const state = await traceRun(
  trace => createAgent({ model, tools, trace }),
  { messages: [human("계산해줘")] },
  { collector, threadId: "thread-1" },
);
const run = collector.spans().find(s => s.kind === "run");
const tree = run && collector.tree(run.traceId);
```

- `traceRun`은 run마다 GraphTrace와 부모 맵을 만든다. build 함수도 run마다 호출한다. 모델·툴 객체는 공유해도 부모는 공유하지 않는다.
- `createAgent({ trace })`는 모델·툴 노드를 감싼다. 실제 모델·툴 호출에 node 부모를 넘겨 자식 스팬을 만든다. 관측 패키지는 model/tools를 import하지 않고 구조적 타입만 요구한다. 두 링을 조립하는 agent가 연결을 담당한다.
- 이미 컴파일된 그래프는 `traceRun(() => graph, input, { collector })`로 실행하면 된다. 이 경우 StepUpdate로 node까지 기록되며 내부 호출은 자동 계측하지 않는다.
- 커스텀 그래프는 `trace.node` 안에서 `tracedModel(model, parent)`와 `tracedTool(tool, parent)`를 사용한다. **run 전용 래퍼가 포함된 그래프를 다른 run에 재사용하지 않는다.** build 함수는 재사용할 수 있다.
- 반환 상태와 던지는 예외는 원래 그래프의 계약을 유지한다. 실패 후에도 전달한 collector에 기록이 남는다.
- `checkpoint` 옵션은 graph.stream에 그대로 전달한다. traceRun은 체크포인트 저장을 수행하지 않는다.

실행 예제는 `packages/observability/examples/react.ts`다. `bun run --filter '@ariadne/observability' example`로 API 키 없이 세 툴 라운드와 마지막 답변의 트리를 볼 수 있다.

## 3. 스팬 데이터와 계층

| 필드 | 의미 |
| --- | --- |
| traceId | run 하나의 16바이트 난수 hex ID |
| spanId / parentId | 작업의 8바이트 난수 hex ID와 부모 ID |
| kind | run / superstep / node / model / tool |
| startedAt / endedAt | Unix epoch 밀리초 |
| status | running / ok / error |
| attributes | 태스크 ID, 쓰기, 반영 여부, 모델·툴 식별자, usage 등 |
| input / output | 관측용으로 복사한 입력·출력 |
| error | 오류 이름과 메시지 |

thread ID는 run의 `ariadne.thread.id` 속성이다. 승인 대기와 재개는 같은 thread 아래 서로 다른 trace가 된다. `traceId`와 `step:index`는 목적이 다르다. 전자는 run 식별자이고 후자는 해당 run 안의 태스크 식별자다.

모델과 툴은 실제 호출 위치의 node 아래 붙는다. 모델 스팬 아래 무조건 툴을 붙이지 않는다. ReAct 그래프에서는 model node가 끝난 후 다음 superstep의 tools node에서 툴을 실행하기 때문이다.

superstep 시각은 그 스텝의 태스크 실행 구간(min start ~ max end)을 나타낸다. Plan·applyWrites의 전체 비용을 별도로 측정한 값은 아니다. run 시각에는 그래프 생성·실행·수집 과정이 포함된다. Unix 시계 보정의 한계도 F6.1과 같다.

사용하는 표준 이름은 `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name`, `gen_ai.tool.call.id`다. 자체 실행 개념은 `ariadne.superstep`, `ariadne.node`, `ariadne.task.id`, `ariadne.channel.writes`, `ariadne.committed`로 남긴다. 모델 입력 기록은 messages이며 SDK 옵션 전체나 HTTP 원문은 수집하지 않는다. usage는 새 모델 호출의 리프 스팬에만 기록하고 부모에 중복 합산하지 않는다.

OTel 참고 버전: [semantic-conventions-genai c88d504의 GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/c88d504ab3d9879f8e50d3cc87e69775e11db234/docs/gen-ai/gen-ai-spans.md). 속성 어휘를 참고했으며 OTel SDK·전송 프로토콜을 구현한 것은 아니다.

## 4. 실패와 종료 계약

성공하면 model/tool wrapper가 자식 스팬을 닫고, StepUpdate가 node와 superstep을 닫고, traceRun이 run을 닫는다. 스팬 종료는 한 번만 적용한다.

모델·툴이 던지면 wrapper는 오류를 기록하고 **동일한 예외 객체를 다시 던진다**. 이후 core의 기존 NodeExecutionError 래핑이 적용된다. writer 오류는 StepUpdate의 태스크 오류를 통해 node에 반영된다. 성공했던 모델 스팬을 뒤늦은 writer 오류 때문에 실패로 바꾸지는 않는다.

리듀서 충돌·입력 실패·그래프 생성 실패는 StepUpdate가 없을 수 있다. traceRun이 run 오류를 남기고 열린 스팬을 마무리하며 예외를 그대로 전달한다. 특히 리듀서 실패는 `InvalidUpdateError` 타입을 보존한다. 이 경우 열린 태스크에는 `ariadne.step.error`와 `committed: false`를 남겨 스텝 실패임을 구분한다. 래핑하지 않은 노드는 StepUpdate가 생성되지 않으면 개별 기록이 없으며 run 오류만 남을 수 있다.

툴 노드의 내부 Promise.all은 형제 툴 하나가 실패하면 다른 호출이 끝나기 전에 거절될 수 있다. 관측 때문에 이 동작을 바꾸지 않는다. 부모 스팬 종료 시 남은 자식 스팬은 부모의 종료 시각에 `ariadne.incomplete: true`와 오류 상태로 닫는다. 이것은 **실제 작업 취소를 의미하지 않는다**. 뒤늦은 완료는 닫힌 기록을 덮어쓰지 않는다. 래퍼를 사용할 때 모델·툴 호출을 await하는 것이 기본 계약이다.

인자 검증 실패처럼 toolNode가 ToolMessage(status=error)로 처리한 결과와, execute가 던지는 예외도 구별해야 한다. tracedTool은 execute를 감싸므로 검증에서 거절된 호출에는 실행 스팬이 없다. 해당 오류 메시지는 node의 writes에 남는다. HTTP 재시도·프로바이더 내부·Claude Code 내부 작업은 별도로 계측하지 않는다.

## 5. 수집기와 저장 경계

TraceCollector는 프로세스 메모리에 스팬을 보관한다. `spans(traceId?)`로 목록을, `tree(traceId)`로 부모관계를 연결한 트리를 받는다. 조회 결과는 복사본이므로 화면이나 호출자가 수정해도 수집기 내용은 바뀌지 않는다.

payload는 기록 시 JSON으로 복사한다. 순환 참조·BigInt 등 직렬화 불가능한 값은 `[unserializable]`로 표시하며 실제 함수에는 원래 입력을 넘기고 원래 반환값을 돌려준다. 비JSON 데이터의 무손실 저장 계약은 아니다. 오류의 stack과 HTTP 상세 필드는 현재 기록하지 않는다.

수집기의 수명은 호출자가 관리한다. `clear()`는 진행 중인 스팬이 없을 때 기록을 비운다. 용량 제한·샘플링·디스크 저장은 아직 없다. 장기 서버에서 무한히 유지할 전역 수집기로 쓰지 않는다. Studio의 기존 요청은 trace 옵션을 켜지 않았으므로 UI에 자동 노출되지 않는다.

다음 저장·UI 작업에서는 완료된 trace를 자체 저장소에 넣고 thread/run으로 조회하도록 한다. 체크포인트와 달리 실패 run도 보존해야 한다. 이는 상태 복원과 관측 기록의 저장 정책이 다른 이유다. 외부 Langfuse 전송은 작업 범위가 아니다.

## 6. 검증

- 3툴 라운드 + 마지막 모델 응답 = run 1, superstep 7, node 7, model 4, tool 3: 총 22스팬.
- createAgent의 관측 유무에 따른 최종 상태 일치, 승인 대기 때 툴 0회, 재개 후 정확히 1회.
- 같은 이름의 Send, 역순 완료, 공유 수집기에 두 run 동시 실행에서도 부모·입력 분리.
- 일반 compiled graph, 0스텝, 체크포인트 복원, 그래프 생성·입력·모델·writer·리듀서 오류.
- 늦은 병렬 툴 완료, 스팬 중복 종료, 조회 결과 변경, 사용량 0/미보고, 순환 값.
- 관측 패키지 runtime deps 0, 외부 import는 core 타입만, AsyncLocalStorage 없음.

최종 검증: `bun run verify` 통과(typecheck + Biome + 전체 회귀 테스트). **424 pass / 3 skip / 0 fail**. 기존 API 키 조건부 테스트 3개는 생략됐고 Studio의 실제 Claude Code 호출 테스트는 실행해 통과했다.
