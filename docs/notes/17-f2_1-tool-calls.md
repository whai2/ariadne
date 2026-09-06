# F2.1 · 툴 호출 왕복 — 문자열 규약을 걷어낼 어휘

## 무엇이 바뀌었나

F1 노트가 남긴 벽은 이거였다.

```ts
interface BaseMessage { content: string }   // ← tool_use / tool_result를 담을 수 없다
```

F2.1은 그 벽을 넘되, **예고했던 방법과 다르게** 넘었다. 이제 이게 돈다:

```ts
const result = await chat.invoke(messages, { tools: TOOLS });
// result.toolCalls → [{ id: "call_1", name: "add", args: { a: 3, b: 4 } }]
g.addNode("tools", (s) => ({ messages: calls.map((c) => tool(c.id, runTool(c))) }));
```

`"도구호출: calc"` 같은 문자열 규약이 아니라 **구조**다. 실행기는 아직 없다 — 예제의
`switch (call.name)`가 그 자리를 메우고, 그게 F2.2를 부르는 벽이다.

## 노트 13의 예고를 뒤집는다

F1 노트는 이렇게 적었다.

> F2는 링만 추가하는 게 아니라 **core의 메시지 타입을 처음으로 확장**한다 —
> `content`를 블록 배열로, `tool` 역할 추가. V8이 "엔진 변경 없이" 끝났던 것과 **대조되는** 지점이다.

**절반만 맞았다.** `tool` 역할은 정말 필요했다. 그런데 `content`는 안 넓혔고, 그래서
**F2도 V8과 같은 성질로 끝났다** — 어휘만 넓어지고 엔진은 안 움직인다.

두 표현을 놓고 골랐다.

| | 블록 배열 (예고안) | **곁들임 필드 (고른 것)** |
|---|---|---|
| 모양 | `content: string \| ContentBlock[]` | `content: string` + `AIMessage.toolCalls?` |
| 원본 | Anthropic 와이어에 가깝다 | **LangChain이 실제로 쓰는 방식** |
| 멀티모달 | 같이 열린다 | 나중에 다시 손대야 한다 |
| 대가 | 7파일 컴파일 에러 + toEqual 대량 수정 | **회귀 0** |

결정적인 건 "원본 충실"이 어느 쪽이냐가 애매했다는 점이다. 예고안은 *Anthropic 와이어*에
충실했지만, 우리가 베끼는 대상인 *LangChain*은 `AIMessage.tool_calls`를 **content와 형제
필드로** 둔다(`messages/ai.py:170`). 즉 곁들임 쪽이 오히려 원본에 가깝다.

멀티모달은 남은 빚이다. 이미지 블록이 필요해지는 순간 `content`를 넓혀야 하고, 그때는
`toolCalls`가 이미 자리를 잡고 있어 **두 표현이 공존**하게 된다(LangChain 1.x가 지금 그 상태다).

## 회귀 0을 만든 한 줄짜리 계약

```ts
...(toolCalls === undefined || toolCalls.length === 0 ? {} : { toolCalls }),
```

**빈 값이면 키를 아예 안 만든다.** 이건 스타일이 아니라 계약이다 — 기존 테스트 ~7파일이
`expect(result).toEqual({ role: "ai", content: "4입니다", id: "msg_abc" })`처럼 **객체를 통째로**
비교하고 있어서, 빈 배열이라도 실으면 전부 깨진다. `human()`/`ai()`가 `id`에 이미 쓰던 수법을
그대로 확장했고, 어댑터는 항상 `extractToolCalls(...)` 배열을 넘기므로 **여기가 유일한 방파제**다.

결과: core 71→81, model 57→88, **studio 38 무변**, 실패 0.

## 번역 지점이 셋이 됐다

F1 노트는 "번역이 필요한 지점은 정확히 둘"이라고 못박았다. 셋째가 생겼다.

| # | 무엇이 다른가 | Anthropic | OpenAI |
|---|---|---|---|
| 1 | 역할 이름 | user / assistant | 같음 |
| 2 | system의 위치 | 대화 밖 최상위 파라미터 | 대화 배열 안 |
| **3** | **툴 결과의 묶음 단위** | **user 메시지 하나의 블록들** | **독립 `role:"tool"` 메시지 낱개** |

3번이 이 단계의 진짜 배울 거리다. 중립형을 **"결과 1개 = 메시지 1개"**(OpenAI 모양)로 골랐는데,
이유가 취향이 아니다 — `addMessages`가 **주소를 붙일 수 있는 단위가 메시지**라서, 결과를 묶어두면
리듀서의 id 교체 규칙이 개별 결과에 닿지 못한다. 묶는 건 와이어의 사정이므로 어댑터가 한다.

그래서 `toAnthropicMessages`가 처음으로 **메시지 개수를 바꾸는 함수**가 됐다.

```ts
let results: Anthropic.ToolResultBlockParam[] = [];
const flushResults = () => { if (results.length) converted.push({ role: "user", content: results }); ... };
```

`openaiCompatible`의 같은 함수는 끝까지 **1:1 map**으로 남는다. 두 파일을 나란히 놓으면
포맷 차이가 그대로 보인다 — 그게 이 저장소가 어댑터를 둘로 쪼갠 이유의 재확인이다.

**system은 런을 안 끊는다**는 판단이 하나 더 있었다. system은 대화에서 통째로 빠져 최상위
파라미터로 가므로, tool 런 중간에 system이 끼어도 없는 것과 같아야 한다. 테스트로 고정했다.

## 넷째 비대칭 — 인자가 객체냐 문자열이냐

Anthropic은 `input: unknown`(파싱된 객체), OpenAI는 `function.arguments: string`(JSON 텍스트).
그런데 OpenAI SDK 주석이 대놓고 경고한다 — *"모델이 항상 유효한 JSON을 만들지는 않는다."*

그래서 파싱 실패를 **예외가 아니라 데이터**로 다룬다.

```ts
catch { calls.push({ id, name, args: {}, invalidArgs: raw }); }
```

`invalidArgs`가 이 커밋에서 태어난 이유가 여기 있다. 원문을 안 실으면 F2.2의 실행기가
"필수 인자 누락"이라고 **오진**한다(진짜 원인은 JSON 파손이고, 모델이 고치는 방법이 다르다).
배열이나 스칼라가 와도 같은 취급이다 — 인자는 객체여야 한다.

## 두 개의 조용한 오작동을 막았다

역할이 3개에서 4개로 늘면서 **기존 코드가 조용히 틀리기 시작하는 자리**가 생겼다.

1. **`claudeCode`의 단일 턴 지름길.** `messages.find(m => m.role !== "system")`이 tool 결과를
   "유일한 턴"으로 집어, 라벨 없이 `7`만 보내게 된다. `role === "human"`으로 좁혀 막았다.
2. **`openaiCompatible`의 빈 대화 가드.** `every(m => m.role === "system")`이 `[system, tool]`을
   통과시켜, 짝 없는 tool_result로 400을 맞는다. tool도 "보낼 턴"이 아니라고 명시했다.

둘 다 **타입 에러가 아니라 논리 구멍**이라 컴파일러가 안 잡아준다. 역할 유니온을 넓힐 때는
`role !== X` 형태의 조건을 전부 다시 읽어야 한다는 교훈이고, 회귀 테스트로 못박았다.

## `claude-code`는 툴을 못 쓴다 — 그리고 그걸 말한다

`ChatModel`에 `supportsTools`가 생겼다. 어댑터 셋 중 `claudeCode`만 `false`다.

`claude -p`는 `result` 문자열 하나를 돌려주고, `--tools`는 **내장 툴 목록**이라 호출자가 정의한
툴을 넣을 자리가 없다. 유일한 경로 `--mcp-config`는 별도 MCP 서버를 세워야 하고 툴 실행이
`ChatModel.invoke` **밖에서** 일어난다 — 이 인터페이스로는 표현이 안 된다(→ F3).

그래서 `options.tools`가 오면 **던진다.** 조용히 무시하면 모델이 산문으로 답하고 그래프가
영영 툴 노드로 안 간다 — F1.7이 하네스 오염에서 겪은 바로 그 종류의 실패다.

`types.ts`가 스스로 세운 규칙("모든 프로바이더에서 의미가 통하는 것만")과 부딪히는데,
`temperature`와 성질이 다르다는 걸로 갈랐다: temperature는 **뜻이 통하는데 거부**되는 것이었고,
tools는 **와이어에 자리가 없는** 것이다. 잘라내는 대신 드러내고 거부한다.

`supportsTools`가 **모델별이 아니라 어댑터별**인 것도 의도다. models.dev는 모델별 `tool_call`
플래그를 갖고 있지만 F1.5가 모델 목록(7,560개)을 레지스트리에 안 담기로 이미 결정했다.
"이 모델이 툴을 잘 부르나"는 우리가 답할 수 없고, 못 부르는 모델은 그냥 안 부르고 끝난다.
`ProviderEntry`에는 필드를 하나도 안 더했다 — `format === "claudeCode"`가 이미 답이다.

## 타입 가드가 필요했던 이유

`BaseMessage`는 판별 유니온이 아니라 **부모 인터페이스**라, `msg.role === "ai"`를 봐도 TS는
`toolCalls`가 있는 줄 모른다. 어댑터마다 캐스팅을 흩뿌리는 대신 `isAIMessage`/`isToolMessage`를
core에 한 번 뒀다 — 둘 다 어댑터 **두 곳**에서 쓰이므로 "여러 곳에서 쓰이면 추출" 규칙에 맞다.

(대안은 `BaseMessage`를 유니온으로 바꾸는 것인데, `MessagesState`·`addMessages`·`StateSchema`가
전부 `BaseMessage[]`를 쓰고 있어 파장이 훨씬 크다. 가드가 싸다.)

## 검증

- **core** (`test/messages.test.ts`, 6→16): 빈 값이면 키 없음 4종 · `tool()`이 id를 안 받음 ·
  리듀서가 여전히 content-blind · 같은 id면 toolCalls까지 교체 · 가드 · **그래프 통합 한 바퀴**
  (roles `[human, ai, tool, ai]` + 호출 id 집합 == 결과 id 집합).
- **anthropic** (24 pass): 빈 content면 text 블록 없음 · `[text, tool_use]` 순서 ·
  **연속 tool 3개 → user 1개** · human이 끼면 갈림 · system은 안 끊음 · `is_error` ·
  `extractToolCalls` · body.tools 전송/미전송 · **2턴 왕복에서 tool_result가 실려 나감**.
- **openaiCompatible** (20 pass): 결과가 **1:1 독립 메시지** · 실패는 본문에 · 인자가 JSON 문자열 ·
  **깨진 JSON은 invalidArgs 보존** · 배열/스칼라도 같은 취급 · 빈 문자열은 인자 없는 호출.
- **claudeCode**: tool 라벨 직렬화 · **단일 턴 지름길 회귀** · `supportsTools === false` ·
  tools 주면 던지고 **프로세스를 안 띄움** · 빈 배열은 통과.
- 전체 `bun run verify` 그린: **207 pass / 3 skip / 0 fail** (studio 38 무수정).

## 실행

```
ANTHROPIC_API_KEY=... bun run --filter '@ariadne/model' example:tools
OPENROUTER_API_KEY=... bun run --filter '@ariadne/model' example:tools openrouter/openai/gpt-5 "3+4와 5×6은?"
```

[`examples/tools.ts`](../../packages/model/examples/tools.ts) — 툴 두 개를 선언하고 한 바퀴를 돈다.
자격증명이 없는 환경에서는 실호출을 확인하지 못했다(가드 경로만 확인). 테스트는 가짜 호출자로
와이어를 직접 관찰하므로 오프라인에서도 전부 돈다.

## 벽 → F2.2

예제를 보면 다음 단계가 뭘 갚아야 하는지 그대로 보인다.

- **스키마를 손으로 쓴다.** `TOOLS`의 JSON Schema가 `runTool`의 TS 타입과 **이어져 있지 않다** —
  둘이 드리프트해도 아무도 안 잡아준다. → zod 하나로 둘 다 뽑는다.
- **인자를 그냥 믿는다.** `Number(call.args.a)`가 `NaN`이 돼도 조용히 흘러간다.
  "모델이 잘못 준 인자"(→ 에러 메시지로 모델이 고침)와 "툴 본문 버그"(→ 전파)를 구분할 자리가 없다.
- **id를 손으로 맞춘다.** `calls.map(...)` 구조가 우연히 지켜줄 뿐, 규칙이 코드에 없다.
- **모르는 툴 이름**이 오면 `"모르는 툴: x"` 문자열이 그냥 결과로 들어간다.

F2.2가 `@ariadne/tools`로 이 넷을 한꺼번에 갚는다.

## 참조

- langgraph/langchain: `libs/prebuilt/langgraph/prebuilt/tool_node.py`(ToolNode·tools_condition),
  langchain_core `messages/ai.py:170`(AIMessage.tool_calls), `messages/tool.py:26-239`(ToolMessage·ToolCall).
- Anthropic Messages API: `tool_use`/`tool_result` 블록, `stop_reason: "tool_use"` (`@anthropic-ai/sdk` 0.124).
- OpenAI Chat Completions: `tool_calls[].function.arguments`(문자열), `role: "tool"` 메시지 (`openai` 7.10).
- 우리: [`graph/messages.ts`](../../packages/core/src/graph/messages.ts),
  [`packages/model/src/`](../../packages/model/src/). 메시지 누적은 [`12-v8-messages.md`](12-v8-messages.md),
  모델 링은 [`13-f1-model.md`](13-f1-model.md), claude-code 트랜스포트는 [`15-f1_7-claude-code.md`](15-f1_7-claude-code.md).
