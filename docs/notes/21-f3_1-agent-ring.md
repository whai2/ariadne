# F3.1 · 에이전트 링 — `@ariadne/agent`, model+tools 자율 루프를 그래프로 접는다

## 왜 이 커밋이 생겼나

F2.3/F2.4를 지나고 나니 ReAct 조립이 **네 곳에서 글자까지 똑같이** 반복되고 있었다:

```ts
g.addNode("tools", toolNode(TOOLS));
g.addEdge(START, "model");
g.addConditionalEdges("model", toolsCondition, ["tools", END]);
g.addEdge("tools", "model");
```

`packages/tools/examples/react.ts` · `apps/studio/examples.ts`의 `react`·`react-repair` ·
`apps/studio/chat.ts`의 `tools` 모양. 노트 19·20이 예고한 그 반복이다.

**반복이 정확히 네 줄이라는 사실 자체가 F3의 논지를 증명한다** — 에이전트는 새 실행기가
아니라 **core 위의 특수한 그래프**다. 그러니 `@ariadne/agent`는 그 네 줄을 접은 것 **이상을
하면 안 된다.** 새 채널도, 새 superstep 개념도, 엔진 수정도 없다. 이 커밋의 진짜 내용은
코드를 줄인 게 아니라, 그 네 줄 사이에 흩어져 있던 **판단들**을 링으로 끌어올린 것이다.

## `createAgent` — 무엇을 받고 무엇을 돌려주나

```ts
const agent = createAgent({
  model: model("anthropic/claude-opus-5"),  // 이미 만들어진 ChatModel
  tools: [add, multiply],                    // AnyTool[] (비우면 단발 호출 그래프)
  system,                                    // 매 호출 invoke 옵션으로
  maxToolRounds: 2,                          // 종료 불변식(아래)
});
const out = await agent.invoke({ messages: [human("3+4랑 5×6")] });
```

반환이 **`CompiledGraph`**인 게 핵심이다. 에이전트가 특별한 실행기였다면 스튜디오의
`stream()`·`getGraph()` 관찰이 안 붙었을 것이다. 그래프이므로 그대로 붙는다 — 그게 F3의
"agent = 특수한 그래프"를 코드로 못박은 지점이다.

`model`은 **이미 만들어진 `ChatModel`을 받는다**(스펙 문자열이 아니라). 그래야 `promptedTools`
같은 **트랜스포트/프로바이더 설정은 모델 생성에 남고**, 에이전트는 트랜스포트를 모른 채
어떤 `ChatModel`과도 돈다. 로드맵이 "promptedTools 자동 결정"을 링으로 올릴지 물었는데,
답은 **아니다** — 그건 모델이 와이어와 어떻게 말하느냐의 문제이지 루프의 문제가 아니다.
에이전트는 그 위에서 트랜스포트-무지(agnostic)로 남는다.

## 판단 · 왜 클래스가 아니라 함수인가 (+ 확장 경로)

`createAgent`는 함수이고 `CompiledGraph`를 돌려준다 — `class Agent`가 아니다. 지금 단계에선
**함수가 정확한 그릇**이다:

- **담을 게 없다.** 클래스가 값을 하는 조건은 (a) 가변 인스턴스 상태 + 그걸 만지는 메서드,
  (b) 상속/다형성, (c) open/close 수명주기다. F3.1 에이전트는 셋 다 없다 — 불변 설정 → 불변
  그래프. 루프 카운터마저 `this`가 아니라 messages 채널에서 센다(위 "run 경계"). `this`에
  얹을 게 없으면 클래스는 빈 껍데기다.
- **반환값이 이미 완성된 객체다.** `CompiledGraph`에 `invoke`/`stream`/`getGraph`가 다 있다.
  클래스로 감싸면 그 메서드를 **위임해 뚫거나** `.graph`를 노출해야 한다 — 군더더기이자,
  스튜디오 관찰이 그래프를 직접 못 받게 만든다(`buildAgentGraph`가 `createAgent(...)`를 그대로
  `stream()`에 넘기는 게 지금은 공짜다). "agent = 그래프"를 코드로 강제하려면 그래프를 그대로
  줘야 한다.
- **저장소의 결과와 같다.** 엔진 전체가 "작은 팩토리 → 그래프에 꽂히는 값"이다
  (`model()`·`defineTool()`·`toolNode()`·`compile()`). `createAgent`는 `compile()`과 같은
  **lowering**이라 함수가 자연스럽다. 참조 원본 langgraph의 `create_react_agent`도 함수다.

**대비 · Mastra는 클래스다(정직).** Mastra `new Agent()`가 클래스인 건 거기 에이전트가
memory·voice·telemetry·서브에이전트·툴 레지스트리·세션 같은 **정체성과 행동을 잔뜩 이기**
때문이다. 즉 함수/클래스는 취향이 아니라 **"에이전트가 그래프냐, 그래프를 품은 객체냐"**라는
갈림길이고, F3.1은 langgraph식(전자)을 골랐다.

**확장 경로.** F3의 남은 커밋(**세션·MCP·승인 게이트**)이 붙어 에이전트가 진짜 가변 상태·
수명주기를 갖게 되면 — 세션 핸들, 열려 있는 MCP 연결, 승인 콜백 — 그때는 그래프를 감싼 더
풍부한 객체(또는 클래스)가 정당해진다. 지금 그걸 미리 만들지 않는 건 CLAUDE.md의 "개념은
필요할 때 등장" 규칙이다. **단 그때도 컴파일된 그래프는 계속 노출한다** — 감추면 스튜디오
관찰이 깨지니, "그래프를 품은 객체"이지 "그래프를 숨긴 객체"가 아니어야 한다. 그 전환의
자연스러운 신호: 설정→그래프 lowering 외에 `this`에 얹을 상태가 처음 생기는 순간.

## 발견 · run 경계는 마지막 human 메시지다 (별도 카운터가 필요 없다)

종료 불변식(F2.3): **답 없는 `tool_use`를 이력에 남기면 안 된다.** 챗이 이력을 계속 이어붙이니
다음 턴이 400이다. F2.3의 해법은 조건부 엣지로 루프를 끊는 게 아니라 **마지막 호출에 툴 선언을
안 주는 것**이었다 — 못 부르니 산문으로 답하고 `toolsCondition`이 자연히 END를 고른다.

스튜디오는 이걸 `turns` 카운터 채널로 셌다(`chatTurn`이 매 턴 0으로 리셋). 에이전트로 옮기며
그 카운터를 그대로 들고 오면 **커스텀 상태 스키마가 강제된다.** 그런데 다시 보니 카운터가
**필요 없었다.**

한 run에서 모델이 이미 몇 번 툴을 불렀나 = **마지막 human 메시지 이후의 `toolCalls` 실린 AI
메시지 수**다. run 경계가 human 메시지인 이유가 분명하다: 챗이 매 턴 이력 전체를 다시 싣는데,
라운드를 이력 **전체**에서 세면 지난 턴의 툴 호출까지 얹혀 **새 턴 첫 호출부터 툴이 막힌다.**
human을 앵커로 삼으면 "이번 요청 안에서 몇 번"이 정확히 나온다.

그 카운터가 **`messages` 채널 안에 이미 있다.** 별도 채널이 필요 없다는 뜻이고, 그래서:

- 기본 에이전트는 **`MessagesState` 하나로 돈다**(커스텀 스키마 불필요).
- 스튜디오가 쓰던 per-turn `turns`와 **동작이 정확히 같다**(둘 다 라운드 N번 후 종료).
- "채널이 유일한 공유 가변 상태"라는 core 불변식과도 맞는다 — 상태를 messages 밖에 안 만든다.

이건 우연이 아니라 "채널에 사는 것만 상태로 둔다"는 규칙이 한 번 더 옳았던 사례다.

## 판단 · 구성 시점에 던진다 (조용한 오작동을 한 걸음 앞으로)

툴을 줬는데 모델이 `supportsTools === false`(promptedTools 없는 claude-code)면 `createAgent`가
**그래프를 세우는 순간** `ModelCannotUseToolsError`로 던진다. 그냥 두면 `invoke`가 툴 없이
호출돼 모델이 산문으로 답하고, 그래프가 **툴 노드에 영영 안 간다** — 타입 에러가 아닌 논리
구멍이다. F2.1이 어댑터 층에서 같은 이유로 던지기로 했는데(노트 17), 에이전트는 그 판단을
**첫 호출이 아니라 구성 시점으로** 당긴다. (스튜디오는 promptedTools를 늘 켜므로 이 문을 안
두드린다 — 이 가드는 링을 직접 쓰는 쪽을 위한 것이다.)

## 판단 · 툴이 없으면 단발 호출

`tools`가 비면 `START→model→END`다. tools 노드도 조건부 엣지도 지어봐야 죽은 가지라 안 짓는다.
같은 `createAgent`가 "툴 에이전트"와 "단발 챗"을 **모양으로 가른다** — 에이전트가 그래프라는 걸
한 번 더 보여주는 자리.

## 깨진 규칙 · 링은 서로를 모른다 → 에이전트가 첫 예외

F2.2에서 `@ariadne/tools`와 `@ariadne/model`을 **서로 모르게** 뒀다(구조적 타이핑으로만 만나고,
호환 검사는 둘 다 의존하는 `apps/studio`의 tsc가 졌다). 에이전트는 그 둘을 엮는 게 존재 이유라
**둘을 다 import한다** — 링 규칙의 첫 예외다. 대신 그 접점(`toolSpecs()`의 결과를
`model.invoke({tools})`에 넘기는 자리)이 **스튜디오에서 이 링으로 이사했다.** 전엔 챗 서버가
지던 몫이 제 집을 찾았고, 이제 `@ariadne/agent`의 tsc가 상시로 검사한다. core는 여전히 런타임
의존성 0이고, 규칙의 본체("채널에 사는 것만 core에")는 안 깨졌다 — 링끼리의 격리 하나가
의도적으로 열렸을 뿐이다.

## 무엇을 이관했고 무엇을 남겼나

- **이관:** `apps/studio/chat.ts`의 `tools` 모양. 모델 노드 + 네 줄 + 루프 상한 + `toolSpecs`
  호출이 전부 `createAgent<ChatState>({ …, schema: chatSchema })` 한 번으로 접혔다. 커스텀
  스키마를 받는 건 langgraph `create_react_agent(state_schema=…)`와 같은 이유 — 챗의
  `turns`/`tasks` 채널을 얹기 위해서다(에이전트 자신은 안 쓴다).
- **남김(정직):** `packages/tools/examples/react.ts`와 스튜디오 갤러리의 `react`·`react-repair`.
  이것들은 **네 줄과 에러 정책을 눈으로 보여주는 교보재**다 — `createAgent`로 접으면 정확히
  가르치려는 걸 숨긴다. 반복을 남긴 게 아니라, 반복이 **본문인** 자리다.

## 안 한 것 (F3의 다음 커밋들)

- **MCP/세션/승인 게이트** — claude-code를 SDK로 확장하는 경로(로드맵 F3에 함께 묶임). 별도
  커밋. 루프는 그때도 우리 엔진 안에 남는다(F2.4가 지킨 핵심).
- **주입 상태·스토어**(toolNode가 F2.2에서 미룬 것), 스트리밍, 구조화 출력, 중단/재개.
- **모델 스펙 문자열 오버로드** — 지금은 `ChatModel`만 받는다. 편의 오버로드는 두 번째
  소비자가 부를 때.

## 검증

257 pass / 4 skip / 0 fail (core 81 · tools 28 · model 97 · **agent 7** · studio 44).
스튜디오·tools·model·core는 **무수정**으로 통과 — 갤러리 예제가 네 줄을 그대로 들고 있어서
회귀 안전망이 그대로 서 있다. 에이전트 단위 테스트 7종: 한 턴 병렬 툴 · 자가 수정 루프 ·
maxToolRounds 종료 불변식 · **run 경계=마지막 human**(지난 턴이 상한을 안 깎음) · 단발 호출 ·
system 전달 · 구성 가드. 진짜 모델 왕복은 스튜디오의 `skipIf(!ANTHROPIC_API_KEY)` live 테스트가
이미 이 경로(chatTurn → createAgent)를 탄다.

## 벽 → 다음

에이전트가 그래프를 돌려주지만, 지금은 **한 번의 자율 루프**만 안다. 세션(멀티턴을 진짜 대화
구조로), 승인 게이트, MCP 확장은 `ChatModel.invoke`보다 큰 인터페이스를 요구한다 — 그게 F3의
남은 커밋이자 claude-code를 SDK로 다루는 자리다.
