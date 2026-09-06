# F2.4 · claude-code 프롬프트 툴 심 — 우리 링이 실행하는 텍스트 기반 툴 호출

## 왜 이 커밋이 생겼나

F2.3까지 claude-code는 툴을 주면 `ToolsUnsupportedError`를 던졌다. 이유는 셋으로 쌓여 있었다
(노트 17·18): `-p`는 텍스트 한 왕복이라 와이어에 툴 선언을 실을 자리가 없고, 돌아오는 건
`result` 문자열 하나이지 구조화된 `tool_use`가 아니다.

그 위에서 질문이 하나 섰다: **"MCP 말고, 우리 toolNode를 붙이면 툴이 붙는 형태는 없나?"**

답을 우리 아키텍처의 핵심으로 갈랐다 — **"각 스텝 가시화 + 워크플로우 제어."** 이 잣대로
길이 둘뿐이다.

| | toolCalls의 출처 | 툴을 누가 실행 | 우리 핵심 |
|---|---|---|---|
| **길 A · 네이티브** | 프로바이더 와이어(`tool_use`) | 우리 `toolNode` | 지킴 (anthropic/openai, F2에서 완성) |
| **길 A · claude-code = MCP** | Claude Code 내부 | **Claude Code 자기 루프** | **깨짐** — 스텝 안 보이고 제어 놓침 |
| **길 B · 텍스트 심** | 우리 어댑터가 텍스트를 파싱 | 우리 `toolNode` | 지킴 |

**MCP는 네이티브지만 우리 핵심엔 틀린 방향**이다 — 루프를 claude 프로세스 안으로 넘긴다.
claude-code를 모델로 유지하면서 핵심을 지키는 유일한 길이 **B**다. 이 커밋이 B다.

## 무엇을 했나

네이티브 tool_use API가 없던 시절의 프롬프트 기반 ReAct 그대로다. **모델 어댑터 층**에서:

1. `renderToolProtocol(specs)` — 툴을 시스템 프롬프트에 **텍스트로** 편다("이런 툴이 있다,
   부르려면 `{"tool_calls":[…]}` JSON만 내라").
2. `parsePromptedToolCalls(text)` — 모델이 뱉은 텍스트를 파싱해 **`ToolCall[]`로 되살린다.**
3. 그 뒤부턴 **`toolsCondition`/`toolNode`가 한 글자도 안 바뀐 채** 돈다. 툴은 우리 링이 실행한다.

```
[MCP]                                  [길 B — 이 커밋]
claude 내부:                           우리 그래프:
  model→tool_use→실행→…→최종텍스트        model→(텍스트)→[심이 toolCalls로]→[우리 toolNode]→model
  └ 이것만 우리에게 옴                    └ 매 hop이 superstep, 채널에서 id 짝이 보인다
```

라이브 검증(실제 `claude` CLI, **API 키 0**):
```
스텝: [model] → [tools] → [model]
  ai: "" 🔧 add({"a":3,"b":4})#call_1, multiply({"a":5,"b":6})#call_2
  tool ←#call_1: "7"
  tool ←#call_2: "30"
  ai: "계산 결과: 3+4=7, 5×6=30"
```

## 판단 · opt-in이 회귀를 0으로 만든다

`promptedTools`는 **`ClaudeCodeConfig`의 옵션이고 기본은 꺼짐**이다. 그래서:

- 기본 claude-code는 여전히 tools를 주면 던진다 → F2.1의 throw 테스트, `supportsTools === false`
  테스트가 **그대로 그린**이다. 안전망을 대체할 일이 없다.
- 켰을 때만 `supportsTools`가 `true`가 되고 심이 돈다.

`supportsTools`의 뜻도 지켰다: "와이어가 툴 정의를 실을 수 있나." 프롬프트 모드에선 와이어(=
프롬프트 텍스트)가 **실을 수 있으므로** true가 맞다 — 다른 수단일 뿐 자리가 생긴 것이다.

## 판단 · 이력에 어시스턴트의 툴 호출을 되살린다

붙이자마자 드러난 구멍. `toPrompt`는 ai 메시지를 `Assistant: ${content}`로 폈는데, 툴을 부르는
ai 메시지는 **content가 비어 있다**(호출은 `toolCalls`에 있다). 그러면 2턴째 프롬프트에
"Assistant: " (빈 줄)만 남아 **모델이 자기가 방금 무슨 툴을 불렀는지 못 본다** — 되풀이하거나
헤맨다.

그래서 `toPrompt`가 toolCalls를 든 ai 메시지를 **규약과 같은 JSON**으로 되살린다:
```
Assistant: {"tool_calls":[{"name":"add","arguments":{"a":3,"b":4}}]}
Tool result: 7
```
네이티브 모드엔 claude-code가 toolCalls를 만들 일이 없으니 이 가지는 프롬프트 모드에서만 탄다 —
기존 `toPrompt` 테스트(`ai("")` 사용, toolCalls 없음)는 그대로 통과한다.

## 정직 · 대가 셋

1. **id를 우리가 만든다.** F2.1이 "id는 프로바이더가 준 걸 그대로 나른다"고 못박았는데,
   프로바이더가 안 주니 `call_1`… 을 붙인다. claude-code는 구조화된 이력을 와이어로 안 보내므로
   (텍스트로 편다) 턴 간 id 재사용이 무해하다 — `toolNode`는 마지막 ai 메시지의 호출만 짝짓는다.
2. **와이어 스키마 강제가 없다.** 모델이 형식을 어길 수 있다. `zod`가 `toolNode`에서 사후
   검증하고, 깨진 arguments는 `invalidArgs`로 원문을 보존한다(OpenAI 비대칭과 같은 처리).
   `stripFence`로 ```json``` 습관도 흡수한다. 그래도 네이티브보다 덜 튼튼하다 — UI가 그걸 알린다.
3. **파싱은 최선 노력이다.** `{"tool_calls":…}`를 통째 파싱 → 실패 시 가장 바깥 `{…}`만 긁어
   재시도. 앞뒤 잡담엔 강하지만 중첩 잡담엔 약하다. 학습용 심의 성질이다.

## 스튜디오 — 흉내지만 막지 않는다

- `buildChatGraph`가 **tools 모양에서 모든 프로바이더에 `promptedTools: true`**를 켠다.
  네이티브 어댑터는 무시하고 와이어에 싣고, claude-code만 이걸 보고 흉내 낸다 → **프로바이더별
  분기가 필요 없다.**
- `ProviderInfo.tools`의 뜻을 "**네이티브인가**"로 좁혔다(claude-code는 false 유지 — 테스트 무변).
  못 쓴단 뜻이 아니다.
- F2.3의 "⚠ 못 쓴다 / 던진다" 경고를 "ℹ 프롬프트로 흉내 낸다 / 덜 안정적" **안내**로 바꿨다.
  막는 게 아니라 알리는 것 — 실제로 돌긴 돈다.

## 회귀 안전망

- **모델 링:** F2.1/F2.3 테스트 전부 그린(opt-in 덕). 추가만 했다 — 심 순수 함수 3종 + 왕복.
- **스튜디오:** F2.3에서 이 세션에 추가했던 "claude-code + tools → 500(ToolsUnsupported)" 테스트를
  **대체**했다. 이제 그 조합은 안 던지고 `buildChatGraph`가 정상으로 선다. 회귀가 아니라 **전제가
  바뀐 것**이라 이유를 테스트에 남겼다(F2.3의 문자열 규약 대체와 같은 성질).

## 검증

model 97 pass / 3 skip · studio 44 pass / 1 skip. 전체 **250 pass / 4 skip / 0 fail**
(core 81 · tools 28 무수정 · model 97 · studio 44). **라이브 확인:** 실제 `claude` CLI로
한 턴 툴 호출·두 툴 병렬 호출 모두 왕복 성공(API 키 0).

## 벽 → 다음

이제 네 어댑터 전부가 툴 루프에 참여한다 — 셋은 네이티브, 하나는 프롬프트 심. 그리고 그 루프
조립 네 줄이 여전히 세 곳에서 반복된다(툴 예제 둘 + 챗 모양). **F3 `@ariadne/agent`**가 그걸
`core 위의 특수한 그래프`로 포장한다 — 그때도 **루프는 우리 엔진 안**이다(이 커밋이 지킨 그 핵심).
