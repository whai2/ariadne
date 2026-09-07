# S9 · 에이전트 사이드바 — 등록한 에이전트를 골라 확인한다 (Mastra 플레이그라운드 대응)

## 왜 이 커밋이 생겼나

F3.1이 `createAgent`를 줬다 — model+tools 한 벌을 그래프로 접는 표면. 그런데 스튜디오에서
에이전트를 쓰는 자리는 **자유 Chat 탭의 tools 모양** 하나뿐이었다. 거기선 매번 프로바이더·모양·
system을 손으로 고른다. Mastra 플레이그라운드는 반대다 — **에이전트를 등록해 두면 사이드바에
뜨고, 고르면 그 에이전트의 설정·그래프·대화가 한 화면에** 나온다. 사용자가 원한 건 그 구조다.

핵심 차이: 자유 Chat은 **엔진 모양을 실험**하는 교보재, 에이전트 뷰는 **고정된 정체성을 가진
에이전트를 확인·대화**하는 곳이다. 둘은 겹치지 않으므로 Chat을 지우지 않고 나란히 뒀다.

## 무엇을 했나

레이아웃을 **상단 탭 → 좌측 고정 사이드바**로 바꿨다(Mastra 그대로). 사이드바:

```
AGENTS
  ● 계산기 에이전트   add·multiply·now
  ● 일반 비서         툴 없음
  ● 시계 에이전트     now
──────────
  Chat      (자유 실험)
  Examples  (갤러리)
```

에이전트를 고르면 우측에 **설정 요약(칩) + 그래프 + 대화 + 스텝 패널**이 뜬다. 설정 칩이
"확인"의 핵심이다 — 어떤 모델인지, 어떤 툴을 들었는지, claude-code면 "툴=프롬프트 흉내"인지,
maxToolRounds가 몇인지를 **대화를 시작하기 전에** 보여준다.

## 판단 · "에이전트 등록"은 배열 한 줄이다

`apps/studio/src/agents.ts`의 `agents: AgentDef[]`에 항목을 얹으면 끝이다. `AgentDef`는
`createAgent`가 받는 것 그대로(`model` 스펙 · `tools` · `system` · `maxToolRounds`)라, 등록 =
**설정 한 벌에 이름 붙이기**다. 새 개념이 없다 — Mastra의 `new Mastra({ agents })`와 같은 발상.

세 개를 골라 `createAgent`의 서로 다른 얼굴을 보여준다: 툴 여럿(계산기) · **툴 없음**(일반 비서
= 단발 호출 그래프) · 툴 하나(시계). 툴 유무만으로 그래프 모양이 갈리는 걸 사이드바에서 바로
눈으로 비교할 수 있다.

## 판단 · 그래프는 자격증명 없이 그린다

`/api/agents/graph`는 **preview 모델**(자리표시자 `ChatModel`)로 그래프를 세운다. 그래야 API
키가 없어도 구조가 뜬다 — F3.1의 "그래프 모양은 모델과 무관하다"를 그대로 쓴다. 진짜 모델은
`/api/agents/chat`에서만 만들어진다(챗의 지연 생성과 같은 이유, S5).

기본 모델이 **claude-code/sonnet**이라 스튜디오를 열자마자 API 키 없이 진짜 에이전트가 돈다.
`buildAgentGraph`가 툴이 있으면 `promptedTools`를 켜서 claude-code가 프롬프트로 툴을 흉내
내게 한다(F2.4). **그래서 claude-code 에이전트도 툴을 쓴다** — 사이드바의 "툴=프롬프트 흉내"
칩이 그걸 미리 알린다(막지 않고 안내).

## 판단 · 렌더링을 두 화면이 공유한다

에이전트 대화 로그와 자유 Chat 로그는 **같은 `msgHtml`/`renderConvo`를 쓴다.** 툴 호출↔결과의
id 짝을 그리는 규칙이 한 곳에만 있어야 두 화면이 안 어긋난다. IME 조합-Enter 처리도
`bindComposer` 하나로 두 컴포저가 공유한다(한글 입력 회귀 가드를 두 번 안 쓴다). 기존 테스트가
검사하던 문자열 조각(`m.toolCalls || []`, `e.isComposing` 등)은 이 공유 함수 안에 그대로 남아
**44개 기존 테스트가 무수정으로 통과**한다.

## core를 진화시켰나 — 아니오

이번엔 관찰 API를 새로 요구하지 않았다. 에이전트 그래프도 결국 `getGraph()`·`stream()`으로
관찰되는 평범한 그래프라, S1~S2가 만든 관찰 표면이 그대로 통했다. F3.1이 "에이전트 = 특수한
그래프"를 코드로 못박은 값이 관찰 층에서도 회수된 셈이다(S5가 live 예제에서 겪은 것과 같다).

## 검증

- 새 엔드포인트 3종 + 페이지 구조 테스트 6개(전체 studio 50 pass / 1 skip).
  - `/api/agents` 설정 반환(계산기 tools=[add,multiply,now], 일반 비서 tools=[], claude-code라
    toolsNative=false)
  - `/api/agents/graph` — 계산기=model⇄tools 루프, 일반 비서=model→END 단발, 모르는 id=404
  - `/api/agents/chat` — messages 없으면 400
  - 페이지에 사이드바·view-agent·"createAgent" 존재
- **실호출(실제 `claude` CLI, API 키 0):**
  ```
  timekeeper "지금 몇 시야?"  → model→tools→model, now(){} → 2026-09-07T09:34:25Z → 최종 답
  calculator "3+4랑 5×6"       → model→tools→model, add·multiply 병렬 → 7·30 → 최종 답
  ```
  등록된 에이전트가 `createAgent`를 통해 툴 루프를 **우리 그래프 안에서** 돌린다는 첫 증명.

## 벽 → 다음

에이전트가 아는 건 여전히 **한 번의 자율 루프**뿐이다. 사이드바가 여러 에이전트를 보여줘도
각 대화는 매 턴 이력 전체를 다시 싣는 stateless 방식이다(챗과 같다). 진짜 세션·트레이스·툴
승인 게이트는 `ChatModel.invoke`보다 큰 인터페이스를 요구한다 — F3의 남은 커밋(claude-code를
SDK로 다루는 자리)이 그걸 채운다.
