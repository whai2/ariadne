# F1 · 모델 링 — 가짜 함수 자리에 진짜 Claude를 꽂다

## 무엇이 바뀌었나

V8 캡스톤의 챗봇 그래프는 이렇게 생겼었다.

```ts
g.addNode("model", (s) => ({ messages: [ai("답: 4")] }));  // 가짜
```

F1은 저 한 줄만 바꾼다.

```ts
const model = anthropicChat();
g.addNode("model", async (s) => ({ messages: [await model.invoke(s.messages)] }));
```

**그래프 구조는 한 글자도 안 바뀐다.** 엣지도, 스키마도, 조건부 루프도 그대로다. 이게 이 단계의
검증이자 링이라는 개념의 요점이다 — 링은 엔진 위에 *얹히지*, 엔진을 고치지 않는다.

core는 여전히 런타임 의존성 0이다. SDK는 링에만 산다.

## 링의 모양 — 중립 어휘와 어댑터

파일이 셋인데 경계가 하나다.

| 파일 | 아는 것 | 모르는 것 |
|---|---|---|
| [`types.ts`](../../packages/model/src/types.ts) | `ChatModel` · `ChatOptions` | **프로바이더 이름조차 안 나온다** |
| [`errors.ts`](../../packages/model/src/errors.ts) | 우리가 에러로 보는 두 상황 | 프로바이더 |
| [`anthropic.ts`](../../packages/model/src/anthropic.ts) | Claude Messages API | — |

```
ChatModel (중립)  ←  anthropicChat() (어댑터)
     ↑
그래프 노드는 여기까지만 안다
```

두 번째 프로바이더가 생기면 `anthropic.ts`와 같은 모양의 형제가 하나 더 생길 뿐, 위쪽은 안 바뀐다.
**레지스트리/라우팅은 지금 만들지 않았다** — 프로바이더가 하나뿐인데 만들면 "미리 선언하지 않는다"
원칙 위반이다. 둘째가 생기는 순간이 추출 시점이다.

## 번역이 필요한 지점은 정확히 둘

`toAnthropicMessages`는 순수 함수라 단위 테스트로 직접 검증한다.

**1. 역할 이름이 다르다.** `human → user`, `ai → assistant`. 단순 매핑.

**2. system의 *위치*가 다르다.** 이쪽이 진짜 배울 거리다.

```
core:        [system, human, ai, human]     ← system이 대화 리스트 안의 한 원소
Anthropic:   system: "...",                 ← 대화와 분리된 최상위 파라미터
             messages: [user, assistant, user]
```

그래서 변환은 **대화에서 system을 뽑아내는** 일이 된다. 그 결과 시스템 지시의 출처가 셋이 되고
(모델 고정 → 호출별 옵션 → 대화 속 system 메시지), 순서대로 합친다.

이건 프로바이더마다 다른 모델링이라 중립 층이 흡수해야 하는 종류의 차이다. OpenAI는 system도
메시지 배열 안에 두므로, 그 어댑터는 이 뽑아내기를 안 한다.

## 응답 id가 V8과 맞물린다

```ts
return ai(extractText(response), response.id);
```

id를 그냥 버려도 동작한다. 그런데 싣고 나면 V8 `addMessages`의 "같은 id면 교체"가 살아난다 —
스트리밍으로 부분 응답을 여러 번 갱신할 때 필요한 바로 그 규칙이다(아직 스트리밍은 없지만 자리는
맞춰뒀다). 멀티턴 테스트가 이걸 관찰한다: 같은 id를 3턴 돌리면 메시지가 **안 늘어난다.**

## 거절은 에러가 아니라 200으로 온다

이 단계에서 제일 안 자명했던 것.

```ts
if (response.stop_reason === "refusal") { ... }   // content를 읽기 **전에**
```

SDK는 인증 실패·레이트리밋·5xx를 타입 있는 예외로 던져준다. 그건 그대로 통과시키면 된다.
그런데 **모델이 안전상 거절한 응답은 HTTP 200**이다 — `stop_reason`만 다르고 예외는 없다.
확인 안 하면 빈 문자열이 조용히 대화에 쌓인다. 그래서 `errors.ts`에 있는 둘은 정확히
**"SDK가 에러로 안 보는데 우리에겐 에러인 것"**이다:

| 에러 | 왜 우리가 잡나 |
|---|---|
| `EmptyConversationError` | system만 있으면 보낼 user 턴이 없다 → 서버 400 받기 전에 끊는다 |
| `ModelRefusalError` | 거절이 200이라 SDK가 안 던진다 |

## `temperature`가 없는 이유

중립 어휘에 뭘 넣을지는 "이름이 예쁜가"가 아니라 **"모든 프로바이더에서 의미가 통하는가"**로
정해진다. 현행 Claude 모델은 샘플링 파라미터(`temperature`/`top_p`/`top_k`)를 **400으로 거부**한다.
그러니 `ChatOptions`에 넣으면 첫 어댑터부터 거짓말이 된다. 프로바이더 전용 손잡이는 어댑터의
생성 설정으로 내려간다.

## 테스트를 어떻게 네트워크 없이 도나

`CreateMessage` 하나만 주입한다 — 클라이언트 클래스 전체가 아니라 **실제로 쓰는 능력 하나**만.

```ts
export type CreateMessage = (
  body: Anthropic.MessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => Promise<Anthropic.Message>;
```

덕분에 가짜를 꽂는 데 `as unknown as`가 필요 없다(V6 노트가 남긴 캐스팅 불만의 재발 방지). 보낸
body를 기록하는 `recorder()`로 **번역 결과를 직접 관찰**한다 — 실호출 없이도 "무엇을 보냈는가"가
테스트된다.

실제 호출 테스트는 `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`로 감쌌다. 키가 없으면 통째로
건너뛴다 — CI·오프라인에서도 `bun run verify`가 그린이어야 하므로.

## 검증 (packages/model/test/anthropic.test.ts)

순수 변환 2 · 어댑터 6(id 실림 / 다중 text 블록 이어붙이기 / system 세 출처 / system 없으면 미전송 /
maxTokens 우선순위 / 빈 대화·거절) · **그래프 통합 2**(누적, 멀티턴 자기 루프) · 실호출 1(skip 가능).
회귀: core 68 · studio 13 전부 무수정 통과.

## 실행

```
ANTHROPIC_API_KEY=sk-... bun run --filter '@ariadne/model' example "질문"
```

[`examples/chat.ts`](../../packages/model/examples/chat.ts) — `stream()`으로 스텝을 찍는다.

## 벽 → 다음 (F2)

```ts
interface BaseMessage {
  content: string;   // ← 여기
}
```

`content`가 string이라 **`tool_use`/`tool_result`를 담을 수 없다.** ReAct 예제가 아직
`"도구호출: calc"` 같은 문자열 규약으로 도는 이유이자, Claude가 실제로 돌려주는 tool_use 블록을
`extractText`가 **버리고 있는** 이유다.

그래서 F2는 링만 추가하는 게 아니라 **core의 메시지 타입을 처음으로 확장**한다 —
`content`를 블록 배열로, `tool` 역할 추가. V8이 "엔진 변경 없이" 끝났던 것과 대조되는 지점이다.

## 참조

- Anthropic Messages API: `POST /v1/messages`(system 최상위 파라미터, `stop_reason: "refusal"`),
  `@anthropic-ai/sdk` 0.124.
- langgraph/langchain 대응: `chat_models/base.py`(BaseChatModel.invoke),
  `langchain_anthropic/chat_models.py`(메시지 변환 · system 뽑아내기).
- 우리: [`packages/model/`](../../packages/model/), 리듀서 채널은 [`06-v3-reducers.md`](06-v3-reducers.md),
  메시지 누적은 [`12-v8-messages.md`](12-v8-messages.md).
