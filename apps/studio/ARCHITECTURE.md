# Studio 구조

`@ariadne/studio` — 그래프 엔진 위에서 도는 **메모리 에이전트 admin**. 이 문서는 **무엇이 무엇을
import하는가**만 다룬다. 각 단계가 왜 그렇게 됐는지는 [`docs/notes/`](../../docs/notes/), 전체 계획은
[`docs/ROADMAP.md`](../../docs/ROADMAP.md).

> **범위가 한 번 좁혀졌다.** 원래 챗 플레이그라운드(프로바이더·그래프 모양 실험)와 예제 갤러리
> (엔진 데모 14종)가 같이 있었는데, **메모리 루프에 기여하지 않는 것을 전부 걷어냈다.** 지운 것:
> `chat.ts` · `examples.ts` · 그 뷰 둘 · 라우트 7개 · 테스트 7블록 · 게이트 없는 에이전트 셋
> (`calculator`·`assistant`·`timekeeper`). 되살리려면 그 커밋 직전을 보면 된다.

## 한 앱처럼 보이지만 프로세스가 셋

```
브라우저 (Vite 번들)          Bun 서버                    자식 프로세스
  web/src/*.tsx     ──HTTP──▶  src/*.ts     ──stdio──▶  mcp-servers/demo.ts
                                                        (+ npx server-filesystem)
```

**`web/src`는 `@ariadne/*`를 하나도 import하지 않는다.** 브라우저는 엔진을 모른다.
UI는 브라우저에서 돌고 서버는 Bun에서 돌기 때문에, [`web/src/api.ts`](web/src/api.ts)에는
**응답 모양만 다시 적는다**(경계에서 타입을 지운 값). 그래서 `Message`·`GraphView`·`StepUpdate`가 `api.ts`에 **다시 선언돼 있다.** 중복처럼 보이지만
HTTP 경계에서 타입은 어차피 지워지고, 공유하면 브라우저 번들이 core를 끌고 들어온다.

## 링 (packages) — Studio 밖

```
@ariadne/core            런타임 deps 0
   ▲   ▲   ▲   ▲
   │   │   │   └── @ariadne/memory     (+ bun:sqlite, 역시 deps 0)
   │   │   └────── @ariadne/mcp
   │   └────────── @ariadne/tools ◀┐
   └────────────── @ariadne/model ◀┤
                                   │
                   @ariadne/agent ─┘
```

`agent`는 `core·model·tools`를 알지만 **`memory`와 `mcp`는 모른다.** 둘은 agent와 형제고,
**만나는 자리는 Studio뿐이다.** (→ ROADMAP "링의 의존 규칙")

`@ariadne/tools`는 이제 **타입으로만** 쓴다(`AnyTool`) — 로컬 데모 툴을 들던 에이전트가 사라져서다.
툴은 전부 MCP 서버에서 온다.

## 서버 (`src/`) — 라우터 → 컨트롤러 → 서비스 → 도메인

```
server.ts                  프로세스: MCP 연결 · MemoryStore 열기 · Bun.serve · 종료
  └ studio.ts              조립: 서비스에 저장소 주입 → 컨트롤러 → 라우트 표
      │
      ▼
    http/router.ts         (method, path) → 핸들러. **실패 → 상태 코드를 옮기는 유일한 자리**
    http/static.ts         dist/ 서빙 (빌드 전이면 안내 페이지)
      │
      ▼
    controllers/           요청 파싱·검증 → 서비스 호출 → Response.json
      agents.ts              list · graph · chat (+ 순수 함수 parseChatBody)
      memory.ts              view
      │
      ▼
    services/              유스케이스. **HTTP를 모른다**
      types.ts               계약: AgentService · MemoryService + 입출력 타입  ← 컨트롤러가 아는 전부
      agents.ts              구현: list · graph · turn  ← memory를 아는 마지막 자리
      memory.ts              구현: view (스토어 없으면 빈 뷰)
      │
      ▼
    domain/                에이전트 그 자체. 위 계층을 모른다
      registry.ts            AgentDef · agents · connectMcpAgents
      graph.ts               buildAgentGraph · approvalPolicy · composeSystem
      providers.ts           "지금 이 모델을 부를 수 있나"

errors.ts                  BadRequestError · NotFoundError — 계층 공용 어휘, 상태 코드를 모른다
```

**`mcp-servers/`는 `src/` 밖에 있다.** 서버 코드가 import하는 모듈이 아니라 `domain/registry.ts`가
자식 프로세스로 **띄우는** 독립 프로그램이라, 계층 어디에도 속하지 않는다(`mcp-sample/`과 같은 자리).

| 계층 | 링 import | 하는 일 | 안 하는 일 |
|---|---|---|---|
| `http/` | 없음 | 경로 매칭 · 에러 → 400/404/500 | 검증 · 비즈니스 규칙 |
| `controllers/` | core·**타입만** | 본문 파싱 · 검증(`BadRequestError`) | `try` · 상태 코드 · 도메인 직접 호출 · **서비스 구현 import**(`services/types`만) |
| `services/` | agent · core · **memory** | 에이전트 찾기(`NotFoundError`) · 턴 조율 · 기록 | `Request`/`Response` |
| `domain/` | agent · core · **mcp** · model · tools | 선언 · MCP 연결 · 그래프 만들기 | memory **기록**(값·콜백만 받는다) |

**실패의 길이 하나다.** 컨트롤러는 "요청이 틀렸다"를, 서비스는 "없다"를 **던지기만** 하고,
`http/router.ts`의 `errorResponse`가 400/404로 옮긴다. 나머지(모델 호출 실패 등)는 500 +
`{ error }`. 그래서 컨트롤러와 서비스에 `try`가 없다 — `runTurn`의 `try/finally`는 에러 처리가
아니라 **에피소드를 반드시 닫기 위한 것**이다.

의존 방향은 [`test/architecture.test.ts`](test/architecture.test.ts)가 강제한다.

## 브라우저 (`web/src/`)

```
main.tsx
  └ theme.tsx (ThemeProvider)
  └ App.tsx                        ← 에이전트 사이드바 (탭 없음)
      └ views/AgentView.tsx        ← turn() = send · decide
            ├ components/Chat.tsx     ChatLog · Composer
            ├ components/Graph.tsx    (+ theme, mermaid)
            ├ components/Steps.tsx
            └ components/Memory.tsx   facts · value_events · episodes
                  │
                  ▼
              api.ts               ← 유일한 서버 접점이자 타입 원본
```

**`api.ts`가 잎이다.** 모두가 여기서 타입을 가져오고, 여기만 `fetch`를 부른다 — 컴포넌트도 뷰도
`fetch`를 직접 안 쓴다.

## 라우팅 — 한 도메인의 3종 세트 + 관찰 창

라우트는 [`studio.ts`](src/studio.ts)의 **표 하나**다. 경로를 추가하는 일 = 표에 한 줄 + 컨트롤러에
핸들러 하나 + (필요하면) 서비스 메서드 하나.

| 목록        | 그래프 구조       | 실행                 | 관찰            |
|-------------|-------------------|----------------------|-----------------|
| `/api/agents` | `/api/agents/graph` | `POST /api/agents/chat` | `/api/memory` |

구조 엔드포인트가 따로 있는 건 **"보내기 전에 그래프를 볼 수 있다"가 스튜디오의 정체성**이라서다.

## 등록된 에이전트 — 둘 다 승인 게이트가 걸려 있다

| id | 툴 출처 | `approval` |
|---|---|---|
| `mcp` | 우리 데모 서버(자식 프로세스, 오프라인) | `write_note` |
| `filesystem` | `@modelcontextprotocol/server-filesystem` (npx) | `write_file` `edit_file` `create_directory` `move_file` |

**게이트가 걸려 있는 게 이 목록의 조건이다.** 승인 버튼이 **가치 신호의 유일한 출처**라
(사람이 [거부]를 누르는 순간이 라벨이다 — F3.3이 F4에 놓아준 다리), 게이트 없는 에이전트는
에피소드만 쌓고 아무것도 배우지 못한다.

## 메모리가 쌓이는 층 — 넷이고 조건이 다르다

| 테이블 | 언제 | 어느 에이전트 |
|---|---|---|
| `episodes` | `runTurn` 1회마다 **무조건** | 둘 다 |
| `value_events` | 사람이 승인/거부를 **실제로 눌렀을 때** | 둘 다 |
| `facts` | 한 툴에 거부 ≥2 **그리고** 거부 > 승인 | 둘 다 |
| `injections` | 사실이 있으면 매 턴 하나씩 시험 | 둘 다 |

격리 키는 `agent`(=`def.id`)다. **DB 파일은 하나인데 격리는 컬럼으로 한다** — 읽는 쪽
(`facts`·`scoredFacts`·`consolidate`)이 전부 `agent`로 거르고, 중복 방지 키도 `UNIQUE(agent, text)`다.
`injections`엔 `agent` 컬럼이 없지만 `fact_id`로 사실에 매달려 있어 새지 않는다.

**대가 둘:** 학습이 에이전트 간에 안 넘어가고(`mcp`의 `write_note` 학습이 `filesystem`에 안 간다),
**사용자 축이 없다**(여러 사람이 쓰면 A의 거부가 B의 프롬프트에 실린다). 후자는 세션이 들어오면
(F4.4) 먼저 깨지는 자리다.

이 넷이 화면에 올라오는 길도 둘이다(S13). **누적**은 `GET /api/memory`를 `Memory.tsx`가 세 블록으로
그리고, **이번 턴에 시험한 사실 하나**는 `AgentReply.injected`로 응답에 실려 대화 바로 위에 뜬다.
후자를 조회로 못 얻는 건 `injections` 행을 에피소드로 되짚는 경로가 없어서고, 만들지 않은 건
클라이언트가 묻는 게 *방금 자기가 부른 턴*이기 때문이다 — `pending`이 그랬던 것과 같은 이유다.

## 흐름 하나 — 승인 게이트가 걸린 턴

턴을 도는 자리는 **코드 전체에 한 곳**([`services/agents.ts`](src/services/agents.ts)의
`runTurn`)이고, 브라우저에서 그 요청을 쏘는 함수도 하나
([`AgentView.tsx`](web/src/views/AgentView.tsx)의 `turn`)다. `turn`을 부르는 자리가 둘 —
`send`(사람이 보낸다)와 `decide`(승인/거부를 누른다). **즉 사람이 버튼을 누를 때만 돈다.**

| # | 사람의 행동 | `decision` | 안에서 도는 것 | 에피소드 |
|---|---|---|---|---|
| 1 | "메모 저장해줘" | 없음 | `model` → 툴 호출 → 게이트가 `"ask"` | `paused` |
| 2 | [거부] 클릭 | `"deny"` | START → `tools` → 거부 → END | `completed` |
| 3 | 같은 요청 → [거부] | `"deny"` | 〃 (**거부 2회 = 임계 도달**) | `completed` |
| 4 | 같은 요청 | 없음 | 진입의 `consolidate`가 사실을 굳히고 하나를 주입 → **모델이 먼저 묻는다** | `completed` |

**보내기와 재개가 같은 엔드포인트·같은 함수다.** 다른 건 `decision` 한 글자뿐이고, 그게 가능한 건
에이전트의 상태가 전부 `messages`이고 그걸 **클라이언트가 쥐고 있어서**다(F3.3).

호출 사슬:

```
Bun.serve                        src/server.ts
└ router (POST /api/agents/chat) src/http/router.ts        ← 던져지면 여기서 상태 코드
  └ agents.chat                  src/controllers/agents.ts ← parseChatBody (400)
    └ service.turn → runTurn     src/services/agents.ts    ← memory를 아는 마지막 자리 (404)
      ├ consolidate · chooseFact · beginEpisode · beginInjection
      │     읽기는 값(ScoredFact[])으로, 쓰기는 콜백(TurnHooks)으로 변신
      ├ buildAgentGraph → createAgent   src/domain/graph.ts → @ariadne/agent
      │   └ graph.stream               @ariadne/core (Pregel)
      │     └ gatedToolNode → policy → hooks.onDecision → recordValueEvent   ← 역류
      └ finally: endEpisode · endInjection(judge(...))
```

**`runTurn`이 그 왕복의 유일한 관문이다.** 아래로는 값과 콜백만 내려가고, 기록은 콜백을 타고
거슬러 올라온다 — domain도 agent 링도 core도 그 일이 벌어지는 걸 모른다.

## 실행

```
bun run studio                              # 루트에서. vite build + 서버 (기본 4111, PORT로 변경)
bun run --filter '@ariadne/studio' dev:ui   # Vite HMR (UI만)
bun test apps/studio
```
