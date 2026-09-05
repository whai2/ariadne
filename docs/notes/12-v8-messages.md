# V8 · 캡스톤 — MessagesState + addMessages

## 무엇이 바뀌었나
교과서 챗봇 그래프 — **대화 상태가 messages 리스트로 누적**되는 걸 core만으로 표현한다. 새 엔진 기능은 **없다.** 최소 메시지 타입 + `addMessages` 리듀서만 추가하면, **V3부터 있던 리듀서 채널에 그대로 꽂힌다.** 이게 캡스톤의 요점 — 엔진이 충분히 일반적이라 "챗봇"이 그냥 "messages 리듀서 채널을 가진 그래프"다.

## 추가한 것 (전부 graph/ 층, 런타임 의존성 0)
[`graph/messages.ts`](../../packages/core/src/graph/messages.ts):
- `BaseMessage { role: "human"|"ai"|"system"; content; id? }` + `human()`/`ai()`/`system()` 팩토리(평범한 객체 → JSON serde 친화).
- **`addMessages(left, right)`**: `right`를 append. 단 같은 `id`가 있으면 그 자리를 **교체**(append-only의 유일한 예외).
- `MessagesState { messages }` + `messagesSchema = { messages: { reducer: addMessages } }`.

## 왜 엔진 변경이 없나 (핵심)
`addMessages`는 시그니처가 `(current, update) => merged` — **그냥 리듀서**다. 그래서:

```ts
new StateGraph<MessagesState>(messagesSchema)   // messages: { reducer: addMessages }
```

이러면 `makeChannel`이 messages를 `BinaryOperatorAggregate(addMessages)`로 만든다(리듀서 있으니). 노드가 `{ messages: [ai("...")] }`를 반환 → 채널이 addMessages로 접어 누적. **V3 리듀서 채널 메커니즘 그대로.** concat 대신 "id 교체가 되는 concat"일 뿐.

## addMessages vs 그냥 concat
| | concat `[...a,...b]` | addMessages |
|---|---|---|
| 기본 | append | append |
| 같은 id | (그런 개념 없음) | **교체** |

id 교체가 필요한 이유: 스트리밍 중 부분 AI 메시지를 같은 id로 여러 번 갱신하거나, 특정 메시지를 정정할 때. append-only 리스트로는 못 한다.

## 검증 (test/messages.test.ts)
addMessages 단위(append / 같은 id 교체 / 다른 id append) · 캡스톤 챗봇(대화 누적) · **멀티턴 루프**(model 자기 루프 3턴 → 메시지 4개 누적) · messages 채널이 `BinaryOperatorAggregate`로 컴파일. (6 케이스)

멀티턴 루프는 V5 조건부(자기 루프) + V8 addMessages의 합작 — `addConditionalEdges("model", s => s.turns < 3 ? "model" : END)`로 돌며 매 스텝 ai 메시지가 쌓인다.

## 로드맵에서의 위치
V1~V7이 쌓은 엔진(채널·superstep·조건분기·Send·Command) 위에 **아무 확장 없이** 챗봇이 얹힌다는 걸 보이는 마무리 단계. 프레임워크 링(`@ariadne/agent`/`memory`)이 이 위에 올라갈 토대 — 실제 LLM/툴 루프는 core 밖(VISION의 Framework 트랙)이다.

## 미룬 것 (범위 밖)
- RemoveMessage(삭제), dict→Message 강제 변환, OpenAI 포맷 변환 — langgraph add_messages의 부가 기능. 최소 캡스톤엔 불필요.
- 자동 id 부여 — 순수성 위해 뺐다. id 없는 메시지는 항상 append(교체는 명시적 id일 때만).
- 실제 모델 호출은 가짜 함수. 진짜 LLM은 `@ariadne/model`/`agent`(Framework 트랙, core 밖).

## 참조
- langgraph: `graph/message.py`(BaseMessage·add_messages·MessagesState).
- 우리: [`graph/messages.ts`](../../packages/core/src/graph/messages.ts). 리듀서 채널은 [`06-v3-reducers.md`](06-v3-reducers.md), 자기 루프는 [`09-v5-conditional.md`](09-v5-conditional.md).
