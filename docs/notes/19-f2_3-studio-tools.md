# F2.3 · 스튜디오 — 문자열 규약을 걷어낸다

## 무엇이 바뀌었나

V5부터 스튜디오 갤러리에 있던 `react` 예제는 이렇게 생겼었다.

```ts
g.addNode("model", (s) => {
  const hasToolResult = s.messages.some((m) => m.content.startsWith("도구결과:"));
  return hasToolResult ? { messages: [ai("답: 4")] } : { messages: [ai("도구호출: calc")] };
});
g.addNode("tool", () => ({ messages: [system("도구결과: 4")] }));
```

툴 호출을 **문자열 접두사로 흉내 낸 것**이다. 그때는 그게 최선이었다 — `content`가 string
하나뿐이라 툴 호출을 담을 자리가 없었으니까. F2.1이 어휘를, F2.2가 링을 만들었으니 이제
갚는다.

```ts
g.addNode("model", (s) => { … ai("", undefined, [{ id: "call_1", name: "add", args: { a: 3, b: 4 } }]) });
g.addNode("tools", toolNode<MessagesState>([add, multiply]));
g.addConditionalEdges("model", toolsCondition, ["tools", END]);
g.addEdge("tools", "model");
```

세 자리가 바뀌었다.

| | 전 | 후 |
|---|---|---|
| 갤러리 `react` | 문자열 규약 | 진짜 `toolCalls` / `tool` 메시지, 한 턴에 호출 둘 |
| 갤러리 `react-repair` | 없음 | 스키마 위반 → 에러 메시지 → 모델이 자가 수정 (새 예제) |
| Chat 탭 | 모양 5개 | **`tools` 모양**이 여섯째로 — 진짜 모델이 툴을 고른다 |

## 노트 18이 예고한 검사가 실제로 발동했다

F2.2는 `@ariadne/tools`가 `@ariadne/model`을 import하지 않는 대신 이렇게 적어뒀다.

> 둘이 실제로 호환되는지 **기계적으로 검사하는 자리가 있다** — 둘 다 의존하는 `apps/studio`의
> `tsc --noEmit`이다(F2.3에서 발동한다).

이번 커밋의 한 줄이 그 자리다.

```ts
model(spec, …).invoke(msgs, { tools })   // tools: ToolSpecShape[]  →  ToolSpec[]
```

`ToolSpecShape.description`은 필수이고 `ToolSpec.description`은 옵셔널이라 통하고,
`JSONSchemaObject`는 양쪽 다 `[key: string]: unknown` 인덱스 시그니처를 갖고 있어
모델 쪽에만 있는 `additionalProperties?: boolean`도 걸리지 않는다. **통과했다.**

같은 인터페이스를 두 벌 적은 값을 여기서 회수한 셈이다 — 링은 서로를 모르는 채로 남고,
호환은 둘을 엮는 앱이 증명한다. 이 검사는 이제 `bun run typecheck`에 상시로 걸려 있다.

## 판단 · 루프를 조건부 엣지로 끊지 않는다

챗은 무한 루프를 막아야 한다. 자연스러운 방법은 `loop` 모양이 쓰는 수법이다.

```ts
g.addConditionalEdges("model", (s) => (s.turns < 2 ? "model" : END), ["model", END]);
```

**툴 모양에선 이게 틀렸다.** 툴 호출이 실린 AI 메시지를 남긴 채로 END를 고르면 답 없는
`tool_use`가 이력에 남는다. 이번 턴은 끝나지만 그 이력을 통째로 다시 싣는 **다음 턴이
양쪽 프로바이더에서 하드 400**이다. 챗은 `convo`를 계속 이어붙이므로 대화가 통째로 죽는다.

그래서 끊는 자리를 엣지가 아니라 **호출 인자**로 옮겼다.

```ts
messages: [await call(s.messages, undefined, s.turns < MAX_TOOL_ROUNDS ? CHAT_TOOL_SPECS : undefined)]
```

마지막 호출에는 툴 선언을 **안 준다.** 못 부르니 모델은 산문으로 답하고, `toolsCondition`이
자연히 END를 고른다 — 이력이 **항상 온전한 상태로** 끝난다. 상한이 제어흐름이 아니라
"무엇을 쥐여주는가"에 있다는 게 요점이다.

같은 불변식(호출 하나당 결과 하나)을 F2.2는 `MissingToolMessageError`로 지켰고, 여기서는
루프 상한의 모양으로 지킨다. **엣지로 지킬 수 없는 불변식이 있다.**

## 판단 · 가짜 모델이 상태를 들면 안 된다

`packages/tools/examples/react.ts`의 가짜 모델은 클로저에 턴 카운터를 들고 대본을 읽는다.
CLI 예제는 한 번 돌고 끝나니 그걸로 충분했다.

스튜디오는 다르다 — 컴파일된 그래프를 `(예제, 모델)` 키로 **캐시해 여러 번 돌린다.**
카운터를 들면 Invoke 두 번째 클릭이 첫 번째와 다르게 굴러, 관찰 도구가 관찰될 때마다
답을 바꾼다. 그래서 두 예제 모두 **`s.messages`만 보고 다음 수를 정한다.**

```ts
const last = s.messages.filter(isToolMessage).at(-1);
if (last === undefined) return …틀린 인자…;      // 아직 안 불러봤다
if (last.status === "error") return …고친 인자…;  // 방금 혼났다
return …최종 답…;                                 // 결과를 받았다
```

세 상황이 마지막 툴 결과 **하나**로 갈린다. 재실행 안전성이 공짜로 딸려온다.

## `supportsTools`가 UI까지 올라왔다

`claude-code`는 툴을 못 쓴다(F2.1). 조용히 무시하지 않고 던지기로 한 결정이 여기서
사용자에게 보인다 — 그런데 **던지는 건 이미 요청을 보낸 뒤**다. 스튜디오의 기본 프로바이더가
하필 claude-code라, 툴 모양을 처음 고른 사람은 대개 여기 걸린다.

그래서 `ProviderInfo`에 `tools: boolean`을 얹었다. `format !== "claudeCode"` 한 줄이면
되므로 **모델을 만들어 보지 않아도 안다** — 자격증명이 없는 환경에서도 UI가 미리 경고한다.

```
⚠ Claude Code는 툴을 못 쓴다 — 와이어에 툴 선언을 실을 자리가 없어 이 모양은 던진다.
```

경고를 띄우되 **버튼을 막지는 않는다.** 실제로 보내면 어댑터가 왜 못 하는지까지 적어
돌려주고, 그게 이 스튜디오가 가르치려는 것이기도 하다.

## 챗 로그가 빈 말풍선을 그리고 있었다

붙이자마자 나온 증상. 툴을 부르는 AI 메시지는 **`content`가 빈 문자열**이라(툴 호출은
`toolCalls` 필드에 있다) 화면상으로는 모델이 아무 말도 안 한 것처럼 보였다.

```
ai
(비어 있음)
tool → #toolu_01…
7
```

`renderLog`가 `toolCalls`와 `toolCallId`를 그리게 고쳤다. 호출 id를 라벨에 박아둔 건
장식이 아니다 — **호출과 결과의 짝**이 이 단계에서 유일하게 눈으로 확인할 값이다.

```
ai
🔧 add({"a":3,"b":4})  #toolu_01A
tool → #toolu_01A
7
```

## 회귀 안전망의 첫 예외

`studio.test.ts`의 두 assert를 **의도적으로 대체**했다.

```ts
- expect(steps.map((s) => s.nodes)).toEqual([["model"], ["tool"], ["model"]]);
- expect(…messages.map((m) => m.content)).toEqual(["2+2 계산해줘", "도구호출: calc", …]);
+ expect(steps.map((s) => s.nodes)).toEqual([["model"], ["tools"], ["model"]]);
+ expect(messages.filter((m) => m.role === "tool").map((m) => [m.toolCallId, m.content]))
+   .toEqual([["call_1", "7"], ["call_2", "30"]]);
```

V0부터 지켜온 규칙("각 단계는 이전 단계의 예제 테스트를 깨지 않는다")의 첫 예외다. 변명이
아니라 구분이 필요하다 — **안전망을 깬 게 아니라 안전망이 지키던 대상이 사라졌다.**
`"도구호출: calc"`는 엔진의 성질이 아니라 그 자리를 임시로 메우던 문자열이었고, 그걸 걷어내는
게 이 단계의 목표 그 자체였다. 그래서 지우지 않고 대체한 뒤 테스트에 왜 그랬는지 남겼다.

엔진의 성질을 지키던 assert(스텝 수, 리듀서 누적, 채널 타입, 조건부 엣지가 그림에 나오는지)는
**하나도 안 건드렸다.** 그 둘을 가르는 선이 이 예외의 범위다.

## 안 한 것 (정직)

- **진짜 모델의 툴 호출을 이 환경에서 확인하지 못했다.** claude-code는 툴을 못 쓰고 이 머신엔
  API 키가 없다. 실호출 테스트는 `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`로 **써두고
  건너뛴다** — F1.7의 CLI 스킵과 같은 방식이다. 키가 있는 곳에서 켜지면 "모델이 add·multiply를
  둘 다 부르고, 마지막 메시지는 산문"까지 검사한다.
- **툴 승인 게이트가 없다.** 모델이 부르겠다고 하면 그냥 돈다. 데모 툴 셋이 순수 계산이라
  지금은 무해하지만, 부작용 있는 툴이 들어오면 필수다(→ F3).
- **스트리밍 없음.** 툴 루프는 모델을 여러 번 부르므로 체감이 가장 나쁜 자리인데, 챗은 여전히
  다 끝나고 한 번에 그린다.
- **주입 상태·인자 강제 제거**는 F2.2에서 미룬 그대로다. 툴이 그래프 상태를 못 읽는다.

## 곁다리로 고친 것

- `.ch .v { word-break: break-all }` — `toolCalls`까지 실린 messages 값이 길어서, 안 접으면
  채널 표가 화면 밖으로 나갔다.
- `studio.test.ts`의 문자열 결합 한 줄을 템플릿 리터럴로. biome CLI가 2.5.12로 올라오면서
  `useTemplate`가 recommended에 들어왔고, 이 커밋과 무관하게 `verify`를 막고 있었다.

## 검증

44 pass / 1 skip (studio). 전체 **241 pass / 4 skip / 0 fail** — core 81 · tools 28 ·
model 88 (앞의 셋 무수정) · studio 44.

새로 확인한 것: 툴 모양 구조가 **자격증명 없이** 그려진다(미리보기의 전제), 프로바이더 목록이
`tools` 플래그를 싣는다, claude-code + 툴 모양이 **500과 읽을 수 있는 이유**로 끝난다
(이 테스트는 CLI도 키도 필요 없다 — 어댑터가 와이어를 타기 전에 거부하기 때문).

## 벽 → 다음

F2가 끝났다. 이제 스튜디오에서 `model ⇄ tools` 루프를 손으로 조립할 수 있는데, **매번 같은
네 줄을 적는다.**

```ts
g.addNode("model", …); g.addNode("tools", toolNode(TOOLS));
g.addEdge(START, "model");
g.addConditionalEdges("model", toolsCondition, ["tools", END]);
g.addEdge("tools", "model");
```

세 곳(툴 예제 둘 + 챗 모양)에서 똑같이 반복됐다. **그게 F3 `@ariadne/agent`의 동기다** —
그리고 이 반복이 정확히 네 줄이라는 사실이, 에이전트가 새 실행 개념이 아니라 **core 위의
특수한 그래프**여야 한다는 F3의 제약을 이미 증명한다.
