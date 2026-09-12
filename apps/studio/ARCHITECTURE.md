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
  web/src/*.tsx     ──HTTP──▶  src/*.ts     ──stdio──▶  mcp-demo-server.ts
                                                        (+ npx server-filesystem)
```

**`web/src`는 `@ariadne/*`를 하나도 import하지 않는다.** 브라우저는 엔진을 모른다.
[`web/src/api.ts`](web/src/api.ts) 첫 줄이 그 선언이다:

> 서버 코드를 import하지 않는다 — UI는 브라우저에서 돌고 서버는 Bun에서 돈다.
> **응답 모양만 여기 다시 적는다**(경계에서 타입을 지운 값).

그래서 `Message`·`GraphView`·`StepUpdate`가 `api.ts`에 **다시 선언돼 있다.** 중복처럼 보이지만
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

## 서버 (`src/`) — 아래에서 위로 한 방향

```
              server.ts          30줄   프로세스: 자원 열고 Bun.serve
                  │
                  ▼
              studio.ts         160줄   HTTP 라우팅 (형제 if 4개)
                  │
                  ▼
              agents.ts         370줄   에이전트 선언 · MCP 연결 · 한 턴
                  │
                  ▼
             providers.ts        70줄   "지금 이 모델을 부를 수 있나"
```

| 파일 | 링 import | 로컬 import | 하는 일 |
|---|---|---|---|
| [`providers.ts`](src/providers.ts) | model | **없음** | 프로바이더 준비 상태 판정 |
| [`agents.ts`](src/agents.ts) | agent, core, **mcp**, **memory**, model, tools(type) | `./providers` | 에이전트 선언 · 한 턴 |
| [`studio.ts`](src/studio.ts) | core(type), **memory**(type) | `./agents` | 라우팅 |
| [`server.ts`](src/server.ts) | **memory** | `./agents` `./studio` | 부팅 · 종료 |
| [`mcp-demo-server.ts`](src/mcp-demo-server.ts) | **없음** | **없음** | 독립 stdio 프로세스 |

읽히는 것 셋:

1. **`agents.ts`가 링을 가장 많이 안다** — 여섯 개 전부. `mcp`와 `memory`를 아는 **유일한** 자리다
   (`server.ts`는 `MemoryStore.open` 한 줄뿐).
2. **`studio.ts`는 `memory`를 `import type`으로만 쓴다.** 라우터는 저장소를 **통과**시킬 뿐 만지지
   않는다는 뜻이고, `/api/memory` 한 곳만 예외로 읽는다.
3. **가로 엣지가 없다.** 사슬이 일직선이다.

## 브라우저 (`web/src/`)

```
main.tsx
  └ theme.tsx (ThemeProvider)
  └ App.tsx                        ← 에이전트 사이드바 (탭 없음)
      └ views/AgentView.tsx        ← turn() = send · decide
            ├ components/Chat.tsx     ChatLog · Composer
            ├ components/Graph.tsx    (+ theme, mermaid)
            └ components/Steps.tsx
                  │
                  ▼
              api.ts               ← 유일한 서버 접점이자 타입 원본
```

**`api.ts`가 잎이다.** 모두가 여기서 타입을 가져오고, 여기만 `fetch`를 부른다 — 컴포넌트도 뷰도
`fetch`를 직접 안 쓴다.

## 라우팅 — 한 도메인의 3종 세트 + 관찰 창

[`studio.ts`](src/studio.ts)의 본문은 `셋업 1줄 + 형제 if 4개`이고 **중첩이 없다** — 각 블록이
`return`으로 끝나므로 **궁금한 하나만 읽으면 되고 앞뒤 문맥이 필요 없다.**

| 목록        | 그래프 구조       | 실행                 | 관찰            |
|-------------|-------------------|----------------------|-----------------|
| `/api/agents` | `/api/agents/graph` | `POST /api/agents/chat` | `/api/memory` |

구조 엔드포인트가 따로 있는 건 **"보내기 전에 그래프를 볼 수 있다"가 스튜디오의 정체성**이라서다.
블록의 모양은 셋 — **A** 그냥 돌려준다(목록) · **B** 찾고 없으면 404(구조) ·
**C** 파싱→검증→`try`로 위임(실행). C에서 `try`가 둘인 건 파싱 실패(400, 클라이언트 잘못)와
실행 실패(500, 키가 없거나 호출이 깨졌다)를 가르기 위해서다.

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
| `episodes` | `agentTurn` 1회마다 **무조건** | 둘 다 |
| `value_events` | 사람이 승인/거부를 **실제로 눌렀을 때** | 둘 다 |
| `facts` | 한 툴에 거부 ≥2 **그리고** 거부 > 승인 | 둘 다 |
| `injections` | 사실이 있으면 매 턴 하나씩 시험 | 둘 다 |

격리 키는 `agent`(=`def.id`)다. **DB 파일은 하나인데 격리는 컬럼으로 한다** — 읽는 쪽
(`facts`·`scoredFacts`·`consolidate`)이 전부 `agent`로 거르고, 중복 방지 키도 `UNIQUE(agent, text)`다.
`injections`엔 `agent` 컬럼이 없지만 `fact_id`로 사실에 매달려 있어 새지 않는다.

**대가 둘:** 학습이 에이전트 간에 안 넘어가고(`mcp`의 `write_note` 학습이 `filesystem`에 안 간다),
**사용자 축이 없다**(여러 사람이 쓰면 A의 거부가 B의 프롬프트에 실린다). 후자는 세션이 들어오면
(F4.4) 먼저 깨지는 자리다.

## 흐름 하나 — 승인 게이트가 걸린 턴

`agentTurn`을 부르는 자리는 **코드 전체에 한 곳**([`studio.ts`](src/studio.ts)의
`POST /api/agents/chat`)이고, 브라우저에서 그 요청을 쏘는 함수도 하나
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
Bun.serve                      src/server.ts
└ studio.fetch                 src/studio.ts
  └ POST /api/agents/chat      ← memory가 밖으로 나가는 유일한 자리
    └ agentTurn(...)           src/agents.ts   ← memory를 아는 마지막 자리
      ├ consolidate · chooseFact · beginEpisode · beginInjection
      │     읽기는 값(ScoredFact[])으로, 쓰기는 콜백(TurnHooks)으로 변신
      ├ buildAgentGraph → createAgent   @ariadne/agent  ← memory라는 단어가 안 나온다
      │   └ graph.stream               @ariadne/core (Pregel)
      │     └ gatedToolNode → policy → hooks.onDecision → recordValueEvent   ← 역류
      └ finally: endEpisode · endInjection(judge(...))
```

**`agentTurn`이 그 왕복의 유일한 관문이다.** 아래로는 값과 콜백만 내려가고, 기록은 콜백을 타고
거슬러 올라온다 — core도 agent 링도 그 일이 벌어지는 걸 모른다.

## 실행

```
bun run studio                              # 루트에서. vite build + 서버 (기본 4111, PORT로 변경)
bun run --filter '@ariadne/studio' dev:ui   # Vite HMR (UI만)
bun test apps/studio
```
