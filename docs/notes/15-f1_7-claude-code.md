# F1.7 · Claude Code 트랜스포트 — 구독 자격증명으로 도는 세 번째 어댑터

## 질문

"구독 모델을 쓰고 싶다." API 키 없이 Claude 구독으로 우리 그래프를 돌릴 수 있나?

처음엔 **없다**고 답했다. 틀렸다.

## 내가 두 번 틀린 지점

1. **"소비자 OAuth는 서드파티에서 막혔다"** — 2차 기사만 보고 단정했다. 사용자는 실제로
   그런 제품을 쓰고 있었다.
2. **"우리 프레임워크는 그 방식을 쓸 수 없다"** — HTTP 클라이언트라 세션이 없으니 불가능하다고 했다.

둘 다 **전제가 틀렸다.** 답은 OAuth도 브라우저 세션도 아니었다.

## 진짜 메커니즘 — 트랜스포트가 다르다

```
@anthropic-ai/sdk            HTTPS → api.anthropic.com     API 키 필요
Claude Code CLI              서브프로세스                    CLI가 자기 자격증명을 쓴다
```

**Claude Code를 실행하면 된다.** 우리가 자격증명을 만질 필요가 없다 — 프로세스를 띄울 뿐이고,
로그인 여부는 그쪽 사정이다. 정책 논쟁도 무의미해진다: 정식 Claude Code가 도는 것이니까.

앞의 두 어댑터는 **와이어 포맷**이 달랐다(Anthropic vs OpenAI). 이건 **트랜스포트**가 다르다.
`ProviderEntry.format`에 세 번째 값 `claudeCode`가 생긴 이유다.

| 어댑터 | 트랜스포트 | 자격증명 | 프로바이더 |
|---|---|---|---:|
| `anthropic.ts` | HTTPS | API 키 | 9 |
| `openaiCompatible.ts` | HTTPS | API 키 | 190 |
| **`claudeCode.ts`** | **서브프로세스** | **CLI 소유** | 1 |

## 220MB를 안 쓰기로 한 판단

처음엔 `@anthropic-ai/claude-agent-sdk`로 구현했다(사용자의 기존 앱이 그렇게 쓰고 있었다).
동작은 했지만 크기를 재보니:

```
SDK 자체                       4.6M
claude-agent-sdk-darwin-arm64  220M   ← 플랫폼 네이티브 바이너리
```

Groq만 쓰는 사람에게 220MB를 강요할 수 없다. 그래서 선택적 의존성 + 동적 import로 우회했는데,
그 전에 CLI를 직접 들여다봤다:

```
claude -p "2+2는?" --output-format json --model sonnet
→ {"type":"result","subtype":"success","result":"4", ...}
```

**필요한 게 그대로 있었다.** SDK는 이걸 감싼 것이고, 단발 텍스트 왕복엔 `spawn`으로 충분하다.
결과: **의존성 0으로 다시 구현.** `@ariadne/model`은 여전히 deps 2개다.

(세션·툴·승인 게이트를 살리려면 그때는 SDK가 값을 한다 → F3)

## 에이전트 하네스를 ChatModel로 좁히기

Claude Code는 chat-completion API가 아니라 **에이전트**다. 내장 툴, 세션, 페르소나를 갖는다.
`ChatModel.invoke(messages) → AIMessage`로 쓰려면 좁혀야 한다.

```ts
buildArgs({ model, system })
// -p                     print 모드: 한 번 답하고 종료
// --output-format json   result 객체 하나
// --disallowed-tools     Bash Read Write Edit Glob Grep WebFetch WebSearch Task NotebookEdit
// --system-prompt        프리셋을 덮어써 Claude Code 페르소나를 걷어낸다
```

**프롬프트는 stdin으로 넣는다.** 인자로 넣으면 길이 제한과 이스케이프가 문제가 된다.

## 손실을 정직하게

`-p`는 문자열 하나를 받는다. 그래서 대화 이력을 **텍스트로 직렬화**한다:

```
Human: 안녕

Assistant: 반가워요

Human: 2+2는?
```

모델이 보는 건 진짜 대화 구조가 아니라 **"대화를 적어놓은 텍스트"**다. 턴이 하나뿐이면
라벨이 잡음이라 내용만 보낸다. 진짜 멀티턴은 세션(`--resume`)이나 stream-json 입력이 필요하고,
그건 `ChatModel`보다 큰 인터페이스를 요구한다(F3).

## id를 안 싣는다

다른 두 어댑터는 응답 id를 `AIMessage`에 실어 V8 `addMessages`의 "같은 id면 교체"를 살렸다.
여기선 **일부러 안 싣는다.** CLI가 주는 건 `session_id`인데, 같은 세션의 여러 턴이 같은 값을
가지므로 그걸 메시지 id로 쓰면 **답변끼리 서로를 덮어쓴다.** id 없이 두면 항상 append다.

## 첫 실호출 검증

F1부터 계속 "실호출 0회"였는데, 이 경로는 **API 키가 필요 없어서** 마침내 돌았다.

```ts
describe.skipIf(!hasCli)("실제 Claude Code 호출 (구독 자격증명)", ...)
```

그래프를 세워 `model("claude-code/sonnet")`으로 진짜 답을 받는다. 키 하나 없는 환경에서.
CLI가 없으면 skip이라 CI는 여전히 그린이다.

## 검증 (test/claudeCode.test.ts)

순수 함수 3종(`toPrompt`·`buildArgs`·`parseResult`) + 어댑터(stdin 경로·시스템 지시 합치기·
빈 대화 차단·실패 구분·id 미부착) + 그래프 통합 + 라우터 선택 + **실호출**. 56 pass · 3 skip.

## 이번에 깨진 불변식

`listProviders`로 "어댑터는 둘뿐"을 단언하던 테스트가 이제 틀렸다. 고쳤지만 **의미를 나눠서**:

- HTTP를 타는 프로바이더의 **와이어 포맷**은 여전히 둘뿐이다
- 세 번째는 포맷이 아니라 **트랜스포트**가 다른 하나다

"모든 엔트리가 인증 방법을 안다"도 예외가 생겼다 — `claude-code`는 `env: []`다.
자격증명이 **우리 밖**에 있기 때문이고, 그게 이 어댑터의 요점이다.

## 참조

- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) — 처음 시도한 경로
- `claude --help` — print 모드 플래그가 실제 근거
- 우리: [`claudeCode.ts`](../../packages/model/src/claudeCode.ts) · 라우터는 [14번 노트](14-f1_5-model-router.md)
