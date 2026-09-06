# F2.2 · `@ariadne/tools` — 정의(zod)와 실행(toolNode)

## 무엇이 바뀌었나

F2.1이 남긴 임시방편은 이랬다.

```ts
const TOOLS = [{ name: "add", parameters: { type: "object", properties: { a: {type:"number"} … } } }];
function runTool(call) { switch (call.name) { case "add": return String(Number(call.args.a) + …) } }
```

스키마를 손으로 쓰고, 인자를 그냥 믿고, id를 손으로 맞추고, 모르는 툴 이름은 결과 문자열로
흘려보냈다. F2.2가 넷을 한꺼번에 갚는다.

```ts
const add = defineTool({
  name: "add", description: "두 수를 더한다",
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: ({ a, b }) => a + b,          // ← a·b가 number로 추론된다
});
g.addNode("tools", toolNode([add, multiply]));
g.addConditionalEdges("model", toolsCondition, ["tools", END]);
```

## 새 엔진 기능이 하나도 없다

이 단계에서 가장 확인하고 싶었던 것. `toolNode(TOOLS)`는 그냥 `NodeFn`이라 `addNode`에
그대로 꽂히고, 병렬 실행은 `Promise.all`이, 상태·제어흐름 갱신은 **V7의 `Command`**가 맡는다.
링이 하는 일은 **프로토콜을 지키는 것**이지 실행 개념을 새로 만드는 게 아니다.

core는 이번 커밋에서 **한 글자도 안 바뀌었다.** F2.1이 어휘를 넓혀둔 덕이다.

## 의존 간선이 안 늘었다

```
@ariadne/core  (런타임 deps 0)
   ↑                    ↑
@ariadne/model     @ariadne/tools      ← 서로를 모른다. tools엔 SDK가 없다.
   ↑                    ↑
        apps/studio (둘을 엮는다)
```

`@ariadne/tools`는 `@ariadne/model`을 **import하지 않는다.** `toolSpecs()`가 내놓는
`ToolSpecShape`가 모델 링의 `ToolSpec`과 **구조적으로 같을 뿐**이다.

같은 인터페이스를 두 번 적는 게 중복처럼 보이지만, 그 대가로 이 링은 **SDK도 모델 링도 모르는
순수 링**으로 남는다. 툴은 "무엇을 할 수 있는가"이지 "누가 부르는가"가 아니다. 그리고 둘이
실제로 호환되는지 **기계적으로 검사하는 자리가 있다** — 둘 다 의존하는 `apps/studio`의
`tsc --noEmit`이다(F2.3에서 발동한다).

대안(`tools → model` 간선)도 VISION의 링 순서상 정당했지만, 링 하나가 다른 링을 몰라도 되면
그걸 고르는 게 이 저장소의 취향이다.

## zod를 들인 자리와 안 들인 자리

**모노레포 첫 스키마 라이브러리이자 첫 비-SDK 런타임 의존**이다. 경계는 이 한 문장으로 정했다:

> **채널에 사는 것만 core에 둔다.**

`ToolCall`은 채널(messages)에 실려 다니므로 core(F2.1). 툴 선언(JSON Schema)은 프로바이더에게
보낼 **산출물**이지 상태가 아니므로 링. core는 여전히 런타임 의존성 0이다.

### `z.toJSONSchema()`의 실측 — 후처리가 한 줄 필요하다

```ts
const { $schema: _dropped, ...rest } = z.toJSONSchema(schema, { io: "input" });
```

- **`$schema`를 항상 붙이고 끄는 옵션이 없다.** 두 프로바이더 어디에도 쓸모없는 메타 키워드라 뗀다.
- **`io: "input"`이 중요하다.** 기본값 `"output"`으로 뽑으면 이렇게 된다:

| 스키마 | `io: "output"`(기본) | `io: "input"`(고른 것) |
|---|---|---|
| `{ a: number, unit: string().default("cm") }` | `required: ["a", "unit"]` | `required: ["a"]` |

기본값이 있는데도 **모델에게 "반드시 보내라"고 말하는** 셈이라 틀렸다. 툴 인자는 모델이
만드는 **입력**이므로 입력 스키마가 맞다. (계획 단계에서는 `additionalProperties: false`가
공짜로 따라오는 `"output"`을 쓸 생각이었는데, 실측하고 뒤집었다.)

대가로 `additionalProperties: false`가 안 붙지만 손해가 없다 — 어차피 zod로 다시 검증하고,
억지로 붙이면 passthrough 스키마에 대해 거짓말이 된다. **OpenAI `strict: true`도 안 켠다**:
`.optional()` 필드가 `required`에서 빠져 바로 깨지고, 검증이 이미 두 겹이라 값이 없다.

`tool.test.ts`의 첫 테스트가 **뱉는 JSON Schema를 통째로 못박는다.** 우리가 통제하지 않는
라이브러리가 프로바이더 요청 본문을 만들고 있으므로, 버전이 올라가도 와이어가 안 흔들리게 하는
유일한 장치다.

### 표현 불가 타입은 정의 시점에 던진다

`unrepresentable: "throw"`가 기본이라 `z.date()`를 쓰면 `defineTool`에서 즉시 터진다.
S5는 "import 시점 throw가 스튜디오를 통째로 죽인다"고 배웠는데, 여기선 반대로 골랐다 —
그건 **환경 문제**(자격증명 없음)였고 이건 **툴 저자의 버그**다. 늦게 터뜨릴 이유가 없다.

## 옮긴 것과 안 옮긴 것

원본(`prebuilt/tool_node.py`)이 2,030줄, 우리 `toolNode.ts`가 180줄이다. 무엇이 본질인가.

**옮긴 것 — 이게 ToolNode의 전부다:**

1. **레지스트리 + 디스패치.** `Map<name, Tool>`, 마지막 AI 메시지에서 호출 읽기, `Promise.all` 병렬.
2. **호출 id당 결과 정확히 하나.** langgraph는 이걸 상류 **세 곳**에서 검사하는데
   (`_validate_tool_command` · `_validate_chat_history` · post-hook 라우터), 우리는
   `calls.map(...)` **구조 자체로** 강제한다. 검사할 게 없으면 어길 수도 없다.
3. **`msg_content_output`의 강제 변환.** 사소해 보이지만 **모델이 읽을 유일한 텍스트**라,
   조용히 `undefined`가 되면 안 된다.
4. **에러 정책의 분기**(아래).
5. **`Command` 반환** — 툴이 텍스트만 돌려주는 게 아니라 상태·제어흐름을 바꿀 수 있다는
   원본의 진짜 새 아이디어.
6. **`tools_condition`의 고정 리터럴** 계약.

**안 옮긴 것(명시):** 주입 상태·스토어 — 그리고 **거기 딸린 인자 강제 제거**
(`tool_node.py:1421-1429`). 나중에 주입을 넣을 때 그 한 줄은 **옵션이 아니라 필수**다:
모델이 `{"state": {...}}`를 지어내 보내면 신뢰된 값으로 위조되는 **프롬프트 인젝션 구멍**이다.
그 외: 스트리밍, `return_direct`, `remaining_steps`, pre/post 훅, `ValidationNode`,
핸들러 어노테이션에서 예외 타입 추론, sync/async 이중화(TS는 Promise 하나라 공짜로 사라진다).

## 에러 정책이 이 단계의 핵심 판단이다

```ts
// 모델이 잘못 준 인자 → 에러 메시지로 돌려준다 (모델이 스스로 고친다)
if (!parsed.success) return toolMessage(call.id, z.prettifyError(parsed.error), "error");

// 툴 본문이 던짐 → 전파한다 (우리 버그다)
const output = await found.execute(parsed.data, ctx);   // ← try/catch가 없다
```

langgraph의 기본값(`_default_handle_tool_errors`)이 정확히 이 분기다. 노브
(`handle_tool_errors`가 받는 여섯 가지 모양)는 **안 만들었다** — 두 번째 소비자가 생길 때.

세 종류의 "모델 잘못"을 **구분해서** 말해준다. 원인이 다르면 고치는 방법도 다르기 때문이다.

| 상황 | 돌려주는 말 |
|---|---|
| 없는 툴 이름 | `'divide'라는 툴은 없다. 쓸 수 있는 툴: add, multiply` ← **목록을 준다** |
| 깨진 JSON (F2.1의 `invalidArgs`) | `인자가 올바른 JSON이 아니다. 받은 원문: {"a":3,` |
| 스키마 위반 | `✖ Invalid input: expected number, received string → at a` |

가운데 줄이 `ToolCall.invalidArgs`가 F2.1에서 태어난 이유의 회수다. 원문을 안 실었으면
여기서 "필수 인자 누락"으로 **오진**했을 것이다.

예제의 장면 2가 이걸 눈으로 보여준다 — 모델이 `{"a": "셋"}`을 보내고, 에러 메시지를 받고,
다음 턴에 `{"a": 3}`으로 고쳐 부른다.

## 예상 못 했던 것 둘 (테스트로 못박았다)

### 1. `Command.goto`는 정적 엣지를 취소하지 못한다 — **더하기**다

```ts
g.addEdge("tools", "model");                        // 정적 엣지
execute: () => new Command({ goto: END, … })        // 멈추고 싶다
// → 실제 스텝: model, tools, model   ← 안 멈춘다
```

V7이 제어흐름을 **채널 쓰기**로 낮췄고([`stateGraph.ts`의 `controlWrites`](../../packages/core/src/graph/stateGraph.ts)),
`END`는 **아무 채널에도 안 쓴다**(아무도 안 깨어나면 그게 종료다). 정적 엣지는 무조건 쓰는
writer라 `branch:to:model`이 그대로 남는다. 쓰기는 합집합이므로 `goto`로는 **뺄 수 없다.**

langgraph도 같은 성질이지만, 우리 쪽은 V7의 설계에서 **구조적으로** 나온다는 게 다르다.
엣지 억제는 core 변경이라 F2 범위 밖 — `goto`는 "행선지를 **추가**한다"로 문서화하고,
취소가 필요하면 `tools`에 정적 엣지를 주지 않으면 된다.

### 2. 툴 둘이 messages 밖의 같은 키를 쓰면 "나중 것이 이긴다"

`NodeReturn<S> = Partial<S> | Command<S>`가 **단일 값**이라(배열이 아니라) N개 결과를 노드
안에서 접어야 하고, 그러면 **채널 리듀서에 닿기 전에** 키가 충돌한다. langgraph는 Command
**리스트**를 반환해 엔진이 합치게 함으로써 이걸 피한다. `messages`는 순서대로 이어붙으므로
영향이 없어서 실전 문제는 아니지만, 성질이 다르다는 걸 테스트로 고정했다.

## 검증 (28 pass)

- `tool.test.ts` (11): **JSON Schema를 통째로 못박음**(`$schema` 없음) · `type:"object"` 항상 ·
  인자 없는 툴 · `.optional()` 제외 · **`.default()`도 required 아님**(io 선택의 근거) ·
  `z.date()`는 정의 시점 throw · spec 모양 · zod 하나에서 검증과 선언이 같이 나옴 ·
  구체 툴이 `AnyTool`로 대입됨.
- `toolNode.test.ts` (17): 마지막 AI 메시지를 **뒤에서부터** · `toolsCondition` · `coerceContent` 4종 ·
  **호출 3개 → 결과 3개 id 1:1 순서 보존** · **병렬임을 지연으로 관찰** ·
  없는 툴/스키마 위반/깨진 JSON 세 갈래 · **툴 본문 예외는 전파** · 기본값이 채워진 인자가 execute로 ·
  Command 병합 · **터미네이터 없으면 `MissingToolMessageError`** · 혼합 · "나중 것이 이긴다" ·
  그래프 통합 · **`goto: END`가 정적 엣지를 못 끊음**.
- 전체 `bun run verify` 그린: **235 pass / 3 skip / 0 fail** (core 81 · tools 28 · model 88 · studio 38).
  core·model·studio는 **한 줄도 안 바뀌었다.**

## 실행

```
bun run --filter '@ariadne/tools' example      # 자격증명 0, 네트워크 0
```

[`examples/react.ts`](../../packages/tools/examples/react.ts) — 가짜 모델인 게 요점이다.
이 단계에서 검증할 건 모델의 똑똑함이 아니라 **툴 프로토콜**이라 결정론적이어야 관찰이 된다.

## 벽 → F2.3

링은 자기 테스트와 예제 안에서만 돈다. 스튜디오의 `react` 예제는 여전히 `"도구호출: calc"`로
**거짓말을 하고 있고**, 툴 결과를 `system` 메시지로 위장하고 있다. 그리고 진짜 모델은
이 링을 통해 아직 한 번도 툴을 안 불렀다.

## 참조

- langgraph: `libs/prebuilt/langgraph/prebuilt/tool_node.py`(ToolNode·tools_condition·
  `_validate_tool_command`·`msg_content_output`·`_default_handle_tool_errors`),
  `chat_agent_executor.py`(create_react_agent의 그래프 골격).
- langchain_core: `tools/convert.py`·`tools/structured.py`(@tool / StructuredTool),
  `utils/function_calling.py`(convert_to_openai_tool).
- zod 4.5.4: `z.toJSONSchema`(`to-json-schema.ts`의 finalize가 `$schema`를 붙인다), `z.prettifyError`.
- 우리: [`packages/tools/`](../../packages/tools/), 어휘는 [`17-f2_1-tool-calls.md`](17-f2_1-tool-calls.md),
  `Command`와 채널 쓰기는 [`11-v7-pregel.md`](11-v7-pregel.md).
