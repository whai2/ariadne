# F6.1 · 관측에 필요한 실행 사실 수집

이번 단계는 **노드가 언제 실행됐고 무엇을 쓰려고 했는지, 어디서 실패했고 모델이 토큰을 얼마나 썼는지**를 남긴다. 스팬 트리·수집기·외부 전송은 F6.2 이후다. 엔진에는 관측 SDK나 trace ID를 넣지 않았다.

## 1. 참고 구현에서 가져온 설계

2026-09-16에 아래 구현을 읽었다. 코드를 복사하지 않고 책임 경계를 참고했다.

| 참고 | 확인한 구조 | Ariadne의 선택 |
| --- | --- | --- |
| Langfuse | observation이 trace에 묶이고 session이 여러 trace를 연결한다. JS observation은 OTel span을 감싼다. processor가 필터·마스킹·배치 전송을 담당한다. | thread는 여러 run의 묶음, run 하나는 trace 하나로 설계한다. 실행 사실 수집과 전송 정책을 분리한다. |
| Mastra | span에 부모·시작/종료 시각·출력·오류가 있다. `end()`는 중복 종료를 막고, `error()`는 기본적으로 스팬을 닫는다. Langfuse exporter가 별도 패키지다. | F6.2의 수집기는 성공/실패 모두 닫힌 span을 만들고 exporter와 분리한다. F6.1에는 그 재료만 제공한다. |
| OpenTelemetry GenAI | 모델·툴 실행에 쓸 공통 속성 이름을 정의한다. | 모델·툴 속성은 `gen_ai.*`, superstep·채널 쓰기는 `ariadne.*`로 계획한다. SDK 의존이나 OTLP 호환 완료를 뜻하지 않는다. |
| LangGraph Python | runner가 task별 쓰기·실패를 저장하고 예외를 다시 전달한다. 실패 시 다른 작업 취소도 다룬다. | task별 결과를 먼저 관찰시킨 뒤 예외를 던진다. pending writes 저장·태스크 취소·중간 재개는 도입하지 않는다. |

참조 코드(커밋 고정):

- [Langfuse observation wrapper](https://github.com/langfuse/langfuse-js/blob/a33763e3c77f7492e5e9defcf633cae9621a66fb/packages/tracing/src/spanWrapper.ts), [span processor](https://github.com/langfuse/langfuse-js/blob/a33763e3c77f7492e5e9defcf633cae9621a66fb/packages/otel/src/span-processor.ts)
- [Mastra span lifecycle](https://github.com/mastra-ai/mastra/blob/0d1facc12c4b3f82795ecf3e537be42452bec8aa/observability/mastra/src/spans/default.ts), [tracing types](https://github.com/mastra-ai/mastra/blob/0d1facc12c4b3f82795ecf3e537be42452bec8aa/packages/core/src/observability/types/tracing.ts), [Langfuse exporter](https://github.com/mastra-ai/mastra/blob/0d1facc12c4b3f82795ecf3e537be42452bec8aa/observability/langfuse/src/tracing.ts)
- [Langfuse data model](https://langfuse.com/docs/observability/data-model), [Mastra tracing overview](https://mastra.ai/docs/observability/tracing/overview)
- [OTel GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) — 표준이 바뀔 수 있으므로 F6.2에서 사용할 속성 목록·버전을 다시 고정한다.
- 로컬 Python 원본: `langgraph/pregel/_runner.py`의 실패 처리와 task별 쓰기 수집. 관측 방식의 참고이며 체크포인터 이식은 아니다.

## 2. 이번 구현: StepUpdate → TaskUpdate

기존 `StepUpdate.nodes`, `state`, `channels`, `checkpoint`는 남긴다. 새로 `tasks`와 `committed`를 제공한다.

```ts
interface TaskUpdate {
  id: string; // run 내부의 step:index
  name: string;
  startedAt: number; // Unix epoch ms
  endedAt: number;
  writes: ChannelWriteEntry[];
  error?: { name: string; message: string };
}
```

`name`만으로는 태스크를 식별할 수 없다. `Send("worker", a)`와 `Send("worker", b)`는 같은 이름으로 동시에 실행된다. `id`는 스케줄러가 정한 순서로 붙이며 완료 순서와 무관하다. 서로 다른 run은 같은 ID를 가질 수 있으므로 전역 trace/span ID로 사용하지 않는다.

시간은 노드 본문과 writer 실행을 포함한다. Unix 시각이라 직렬화·다른 이벤트와 정렬하기 쉽지만, 시스템 시계 보정에 영향받으며 단조 증가 시간을 보장하지 않는다. 토큰 생성 지연이나 모델 단독 소요 시간을 이 값에서 추측하지 않는다.

`writes`는 **writer가 반환한 상태 채널 쓰기**다. 제어 채널(`branch:to:*`, join, TASKS)은 제외한다. 리듀서 적용 전 값이므로, 누적 채널에 2를 썼으면 최종 합이 15여도 이 기록에는 2가 남는다. 실패한 writer 내부에서 반환하지 못한 값은 수집할 수 없다.

### 성공 경로

1. Plan에서 태스크 목록과 순서를 정한다.
2. 각 태스크의 시작 시각을 기록하고 본문·writer를 실행한다.
3. 쓰기 버퍼와 종료 시각을 수집한다.
4. 모두 성공하면 기존대로 트리거 consume → applyWrites → expireStale를 실행한다.
5. `committed: true`, task별 결과, 업데이트된 상태를 yield한다.

### 실패 경로

1. 본문이나 writer가 던지면 원인을 `NodeExecutionError.cause`에 보존한다.
2. 같은 superstep의 형제 태스크가 끝날 때까지 기다려 성공·실패 결과를 모두 수집한다.
3. 트리거 consume과 쓰기 반영을 건너뛰고 `committed: false` 이벤트를 yield한다. 상태·체크포인트는 해당 스텝 쓰기를 반영하기 전 값이다.
4. 소비자가 다음 `next()`를 호출하면 `NodeExecutionError`를 던진다. `invoke()`와 `for await`는 이를 그대로 받는다.

실패가 여럿이면 모두 `tasks[].error`에 남고, 스케줄러 순서의 첫 실패를 던진다. 기존 스케줄러는 이름으로 안정 정렬한다. `NodeExecutionError`에는 `node`, `step`, `taskId`, 원본 `cause`가 있고, 메시지에도 원래 오류 메시지를 포함한다. 기존 예외의 타입 자체를 검사하던 호출자는 이제 `cause`를 확인해야 한다.

`committed: false`는 성공한 형제의 쓰기까지 미반영이라는 뜻이다. 외부 API 호출·파일 쓰기 같은 부작용을 되돌렸다는 뜻은 아니다. 형제 취소도 없으므로 끝나지 않는 태스크가 있으면 실패 이벤트도 기다린다. 실행 도중 이벤트를 내보내는 실시간 노드 시작 스트림은 아니다.

입력 주입·Plan·최종 applyWrites의 실패는 이번 task 오류 계약에 포함하지 않는다. 특히 리듀서 충돌은 기존 `InvalidUpdateError` 그대로 던진다. 채널 여러 개의 업데이트를 원자적으로 롤백하는 기능도 추가하지 않았다.

core는 관찰값을 깊은 복사하거나 JSON으로 제한하지 않는다. 노드는 받은 상태를 직접 변경하지 않고 새 쓰기를 반환해야 하며, 관찰자도 이벤트를 읽기 전용으로 취급해야 한다. in-place 변경에 대한 과거 스냅샷 보존을 약속하지 않는다. 오래 보관할 JSON 기록의 분리는 소비하는 링이 담당한다.

## 3. 모델 사용량

`AIMessage.usage`의 공통 타입은 `TokenUsage { inputTokens, outputTokens }`다. 메시지에 붙는 데이터이므로 core에 어휘만 두고, 프로바이더 응답 해석은 model 링에서 한다.

| 어댑터 | inputTokens | outputTokens |
| --- | --- | --- |
| Anthropic | input_tokens + cache_creation_input_tokens + cache_read_input_tokens | output_tokens |
| OpenAI 호환 | prompt_tokens (캐시 포함, details를 더하지 않음) | completion_tokens |
| Claude Code | CLI result.usage의 Anthropic 형식 입력 합 | CLI result.usage.output_tokens |

Anthropic의 캐시 입력은 별도 필드다. 합산하지 않으면 캐시를 많이 쓴 실행이 입력을 거의 쓰지 않은 것처럼 보인다. [Anthropic 캐시 사용량 설명](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)을 기준으로 맞췄다.

미보고·불완전·유효하지 않은 사용량은 `usage`를 생략한다. 보고된 0은 보존한다. 선택적 캐시 필드의 null/누락은 0으로 해석한다. 비용·실측하지 않은 토큰 수는 만들지 않는다. usage 문제 때문에 정상 모델 응답을 실패시키지 않는다.

Claude Code 값은 **CLI 호출 전체의 집계**이며, 내부 모델 호출 하나의 계측이라고 볼 수 없다. `modelUsage`를 다시 더하지 않는다. 공개 `parseResult(stdout): string` 계약은 유지하고, 어댑터 내부에서만 텍스트와 usage를 함께 해석한다. text/tool-call 응답 모두 같은 경로로 usage를 싣는다.

후속 집계는 그 run에서 새로 발생한 모델 호출의 사용량만 한 번씩 센다. 복원된 대화 이력 전체를 다시 더하거나 부모 span의 합과 자식의 사용량을 함께 더하면 중복 집계다.

## 4. F6.2 설계와 남은 접점

다음 계층을 목표로 한다. 이 부분은 아직 구현되지 않았다.

```text
thread (여러 run을 묶는 식별자)
└─ run / trace
   └─ superstep
      ├─ task / node
      │  └─ model call 또는 tool call
      └─ task / node
         └─ model call 또는 tool call
```

모델과 툴은 항상 서로의 부모·자식이 아니다. ReAct에서는 각각 다른 graph node 안에서 실행될 수 있다. 승인 대기 후 재개는 같은 thread의 새 run으로 표현한다.

`@ariadne/observability`는 span ID·부모관계·종료 상태와 collector를 소유한다. engine은 실행 사실, model/tool wrapper는 내부 호출 사실을 제공한다. collector 실패가 실행 실패를 대체하지 않게 하고, 종료는 한 번만 처리해야 한다. 외부 전송·마스킹·샘플링·flush 정책은 별도 책임이다.

**설계상 남은 문제:** StepUpdate는 실행 뒤에 도착한다. 시각이 겹친다는 이유로 모델 호출을 특정 태스크의 자식으로 추정하면 병렬 실행에서 틀린다. `traced(model)` 하나만으로도 해결되지 않는다. 모델을 공유하는 두 태스크는 서로 다른 부모를 전달해야 한다.

따라서 F6.2 첫 작업은 **실행 전에 명시적인 부모 컨텍스트를 연결하는 경로**를 확정하는 것이다. 우선 링에서 node를 감싸 실행 컨텍스트를 만들어 model/tool wrapper에 전달하는 방안을 검증한다. compiled graph를 실행한 뒤 받은 task ID와 이 컨텍스트를 어떻게 정확히 연결할지도 같은 테스트로 증명해야 한다. core의 시작 콜백이나 AsyncLocalStorage를 당연한 전제로 도입하지 않는다. 현재 이벤트 계약만으로 임의의 compiled graph에 완전한 중첩 계측이 자동으로 붙는다고 주장하지 않는다.

F6.2 완료 조건은 병렬·동일 이름 Send·여러 run 동시 실행에서 부모가 섞이지 않는 것, 실패해도 열린 span이 남지 않는 것, 관측 때문에 상태·예외가 달라지지 않는 것이다. 모델·툴 없이 0스텝으로 끝난 run과 입력·리듀서 오류도 run wrapper에서 닫혀야 한다.

## 5. 검증과 현재 범위

- 역순으로 끝나는 병렬 노드도 쓰기 귀속·BSP 합산이 유지된다.
- 같은 노드로 가는 Send 두 개의 ID가 다르다.
- 실패 이벤트를 먼저 받고 다음 next에서 원인과 함께 예외를 받는다. invoke도 던진다.
- 여러 실패와 writer 실패를 보존하며 성공한 형제의 쓰기도 반영하지 않는다.
- 가짜 프로바이더로 캐시 합산, text/tool 응답 전달, 미보고와 0을 검증한다.
- 기존 실패 run의 SQLite 정지점 보존 회귀 테스트도 그대로 실행한다.

실패 이벤트가 SQLite에 영구 저장되는 것은 아니다. `runWithCheckpoint`는 스트림을 끝까지 소비한 정상 run만 저장하므로 실패 run은 기존 정지점을 덮어쓰지 않는다. 실패 트레이스의 별도 수집·보관은 후속 collector의 책임이다. Studio의 트레이스 UI와 Langfuse 연동도 이번 구현에 포함하지 않는다.

최종 검증: `bun run verify` 통과(typecheck + Biome + 전체 테스트). **409 pass / 3 skip / 0 fail**. 3개 skip은 API 키가 필요한 기존 모델 테스트이며, Studio의 Claude Code 통합 테스트는 실제 실행해 통과했다.
