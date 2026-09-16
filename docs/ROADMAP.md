# Ariadne 로드맵 — 진화식 (walking skeleton)

## Context

LangGraph를 TypeScript로 **바닥부터 재구현**하며 내부 구조를 학습한다.
학습 방식은 **진화식**이다: 처음부터 끝까지 **돌아가는 가장 작은 엔진**으로 시작해, 매 단계마다 *여전히 돌아가는* 채로 조금씩 진짜 langgraph 구조로 탈피시킨다.

> 이전 버전은 의존성 순서로 주춧돌을 먼저 까는 **bottom-up 계층식**이었다. 그건 "전체 구조를 이미 아는 사람"의 선언 방식이라, 완성이 마지막에 몰려 "작게 돌아가는 걸 보며 배운다"는 목표와 어긋났다. 그래서 **순서를 계층식 → 진화식으로 재구성**했다. (도착지 지도인 "아키텍처 불변식"은 그대로 유지.)

참조 원본(Python): `/Users/no-eunsu/coxwave/langgraph/libs/langgraph/langgraph/` — 읽기 전용 참고, **복붙 금지**.

> **이 문서는 진행 계획의 원본이다.** 프로젝트는 모노레포이며, `V1~V8`은 `packages/core`(`@ariadne/core`) 그래프 엔진(**완료**), `F1~F5`는 그 위의 프레임워크 링, `F6~F9`는 운영층(관측·평가)과 **아리아드네의 실**을 다룬다. 전체 비전(올인원 프레임워크 · Studio · 네 트랙 · 실의 정의)은 [VISION.md](VISION.md) 참조. **지금 집중 = Ops·Thread 트랙(F5~).**

## 이 방식의 규칙

- **매 단계가 실행된다.** V1부터 `bun test`로 실제 그래프가 도는 걸 본다.
- **개념은 "필요해서" 등장한다.** `MISSING` 센티넬은 V2(채널에 '비어있음'이 처음 필요할 때), `TASKS`/`PUSH` 상수는 V6(Send가 생길 때) 태어난다. **미리 `constants.ts`를 채워두지 않는다.** 여러 곳에서 쓰이기 시작하면 그때 모듈로 추출(정리 리팩터).
- **리팩터가 곧 학습.** "순차 실행 → superstep"(V4)처럼 직접 벽에 부딪힌 뒤 langgraph가 왜 그 복잡성을 갖는지 이해한다.
- **회귀 안전망.** 각 단계는 이전 단계의 예제 테스트를 깨지 않는다. 예제와 테스트는 계속 쌓인다.

### 확정된 방향
- **개념 중심 재구성** — async 한 벌, 처음엔 JSON serde, 실제 쓰는 것만.
- **런타임 의존성 0개** — 메시지 타입도 직접 정의.
- **Core 트랙의 목표 범위: 실행 엔진까지** — 채널 → Pregel 루프 → 동작하는 StateGraph. (영속성/인터럽트/스트리밍/함수형 API는 범위 밖.)
  - **F5에서 선을 다시 긋는다:** *채널이 자기 값을 내놓고 되받는 능력*은 채널의 성질이라 core, *그 값을 어디에 두는가*는 링. **인터럽트(superstep 한가운데 멈춤)는 여전히 범위 밖** — 우리 멈춤은 항상 정지점이다.

## 아키텍처 불변식 (도착지 지도 — 최종적으로 이렇게 수렴)
1. **채널이 유일한 공유 가변 상태.** 쓰기는 버퍼링됐다 superstep 경계에서 `applyWrites`로만 반영. (V4에서 도달)
2. **superstep = Plan → Execute → Update.** step N의 쓰기는 step N+1에서만 보임(BSP). (V4)
3. **StateGraph는 순수 sugar** — `compile()`이 Pregel로 낮춤(노드→`PregelNode`, 엣지·라우터·`Command`→채널 쓰기). (V7에서 도달)
4. **폴더 경계는 한 방향** — `공용 어휘 ← pregel/(엔진) ← graph/(사용자 API)`. 엔진은 StateGraph를 모르고 접점은 `PregelSpec` 하나. (V7에서 도달, `test/architecture.test.ts`가 강제)

---

## 진화 단계 (V0 → V8)

각 단계: **무엇이 새로 도는가 / 새 개념·상수 / 직전 단계의 벽 / langgraph 참조 / 검증**. 검증은 단계마다 `bun:test` + `docs/notes/NN-*.md` 분석 노트.

### V0 · 하네스 — [x] 완료
Bun + tsc + Biome + lefthook + CI. (커밋 `d0974fd`, `8b7b54c`)

### V1 · 최소 실행 그래프 (walking skeleton)
- **도는 것:** `StateGraph` — `addNode(name, fn)`, `addEdge(from, to)`, `compile()` → `invoke(input)`. 선형 `START→a→b→END` 실행.
- **내부:** 상태 = 평범한 객체. compile은 노드/엣지 맵 보관(거의 no-op). invoke는 START에서 단일 아웃엣지를 따라가며 `state = {...state, ...fn(state)}`, END에서 멈춤.
- **새 개념·상수:** `START`, `END` (처음 필요한 상수). 노드 = `(state) => 부분상태`.
- **참조:** `graph/state.py`의 add_node/add_edge/compile/invoke **표면만**.
- **검증:** 선형 그래프가 상태를 변환.
- **벽 → 다음:** 상태가 그냥 겹쳐쓰기라 "키별 통일된 저장 규칙"·"같은 키 다중 쓰기"가 애매.

### V2 · 채널로 상태 저장 — [x] 완료
- **도는 것:** 동일 선형 그래프가 이제 **채널 기반**으로 동일 출력.
- **내부:** 상태 객체 → `channels: Record<string, LastValue>`. 읽기=각 채널 `get()`, 쓰기=부분상태의 각 키를 `channel.update([v])`.
- **새 개념·상수:** **`MISSING` 센티넬** + `EmptyChannelError`(채널의 "아직 안 써짐"). `LastValue`(step당 1회 쓰기, 2회면 `InvalidUpdateError`).
- **참조:** `channels/base.py`, `channels/last_value.py`, `_internal/_typing.py`(MISSING).
- **검증:** 빈 채널 get→에러, update→get 왕복.
- **벽 → 다음:** 두 노드가 같은 키를 쓰면 LastValue가 거부 → **누적**이 필요.

### V3 · 리듀서 채널 — [x] 완료
- **도는 것:** 상태 키를 `{ reducer }`로 선언하면 값이 **누적**(예: 리스트 concat, 카운터 +).
- **내부:** 리듀서 있으면 `BinaryOperatorAggregate`, 없으면 `LastValue`로 채널 파생.
- **참조:** `channels/binop.py`, `graph/state.py`의 `_get_channels`.
- **검증:** `items: concat`, `count: add` 누적.
- **벽 → 다음:** 동시에 여러 노드가 돌면 그 업데이트들을 한 번에 접어야 하는데, 지금은 순차라 병렬/팬인이 불가.

### V4 · superstep (BSP) — [x] 완료 ← 가장 큰 전환
- **도는 것:** 다이아몬드 `START→a→{b,c}→d→END` (b,c 병렬, d 팬인) 실행. 아웃엣지 여러 개(분기) 허용.
- **내부:** 순차 edge-following → **Plan/Execute/Update** 슈퍼스텝으로 리팩터.
  - **Plan**: 활성 노드 집합(START 대상 → 직전 실행 노드들의 아웃엣지 대상, 중복 제거).
  - **Execute**: 같은 스냅샷을 읽고 병렬 실행(`Promise.all`), 쓰기는 버퍼.
  - **Update**(`applyWrites` + `collectWrites`): 채널키별로 모아 한 번에 반영, 같은 채널 여러 쓰기는 리듀서가 fold.
  - `StepUpdate`: `{node}` → `{step, nodes[]}`.
- **V3가 전제였던 이유 증명:** 병렬 쓰기 + 리듀서 → 합침 / + LastValue → `InvalidUpdateError`.
- **V7로 미룸(정직):** 스케줄링을 트리거 채널(`EphemeralValue`)로 구현하는 것, 스태거드 팬인 join(`NamedBarrierValue`)은 langgraph 정합 단계(V7)에서. 지금은 활성 집합을 아웃엣지로 직접 계산.
- **참조:** `pregel/_algo.py`(apply_writes), `pregel/_loop.py`.
- **벽 → 다음:** 고정 엣지만으론 런타임 조건 분기 불가.

### V5 · 조건부 엣지 — [x] 완료
- **도는 것:** `addConditionalEdges(source, router)` — router(state)→다음 노드명. 조건 분기/루프 실행.
- **내부:** 라우터 결과를 해당 트리거 채널 쓰기로.
- **참조:** `graph/_branch.py`, `graph/state.py:982`.
- **검증:** 짝/홀 라우팅, 자기 루프.
- **벽 → 다음:** 정적으로 이름 아는 노드만 가능 — 런타임 N개 동적 생성 불가.

### V6 · Send 팬아웃 (map-reduce) — [x] 완료
- **도는 것:** 입력 리스트 → 각 항목을 동적 병렬 처리 → 리듀서로 취합.
- **내부:** 노드/라우터가 `Send(node, arg)` 반환 → 예약 `TASKS` 채널 → 다음 tick에 동적 **PUSH** 태스크로 스케줄.
- **새 개념·상수:** **`TASKS`, `PUSH`, `PULL`**(대역 내 신호 — *필요해서* 등장). `Send`. `Topic` 채널(TASKS 백킹).
- **참조:** `types.py`(Send), `pregel/_algo.py`의 PUSH 처리, `channels/topic.py`.
- **검증:** map-reduce 그래프.
- **벽 → 다음:** 노드 반환/제어흐름이 임시방편 — 원본 구조(Command, PregelNode/ChannelWrite)와 어긋남.

### V7 · Command + compile 정합 — [x] 완료
- **도는 것:** 앞의 모든 예제가 **원본과 같은 내부 구조**에서 그대로 돎(리팩터 안전망). + 비대칭 팬인 join.
- **내부:** compile이 노드→`PregelNode`(triggers/bound/writers), 엣지·라우터·`Command.goto`→ 전부 **채널 쓰기**(`branch:to:<노드>` / `TASKS`), 다중소스 엣지(`addEdge([b,e], d)`)→`NamedBarrierValue`. 스케줄링은 "갱신된 트리거 채널을 구독한 정점"으로 대체 — `dedupePullTasks` 삭제.
- **새 개념·상수:** `Command`, `PregelNode`/`ChannelWriteEntry`/`Writer`, `TASKS`·`branchTo`·`joinTo`, 채널 `EphemeralValue`/`NamedBarrierValue`/`Topic`, `BaseChannel.consume/copy`. 라우터는 **로컬 읽기**(자기 쓰기만 반영)로 상태를 본다. `addNode<I>`로 Send 워커 payload 타입 정리.
- **안 한 것(정직):** `CONFIG_KEY_READ/SEND` 클로저 주입(우리 writer는 엔진이 직접 호출 → `read`를 인자로), `PregelNode.channels/mapper`(그래프당 스키마 1개), START를 진짜 정점으로 두기(초기화에 접음), 채널 버전(`versions_seen`), `trigger_to_nodes` 역인덱스.
- **참조:** `pregel/_read.py`, `pregel/_write.py`, `pregel/_algo.py`(apply_writes·prepare_next_tasks·local_read), `graph/state.py:1509,1531,1551,1760`, `channels/{ephemeral_value,named_barrier_value,topic}.py`, `types.py`(Command).
- **검증:** 회귀(V1~V6 예제 전부 통과) + `getChannelNames()`로 낮춘 구조 대응 + 새 채널 3종 단위 테스트. ([노트 11](notes/11-v7-pregel.md))

### V8 · 캡스톤 — MessagesState + addMessages — [x] 완료
- **도는 것:** 교과서 챗봇형 그래프(모델 호출은 가짜 함수)에서 대화 상태가 메시지 리스트로 누적.
- **내부:** 의존성 없는 최소 `BaseMessage`/`human`/`ai`/`system` + `addMessages` 리듀서(같은 id면 교체, 아니면 append). 새 엔진 기능 없음 — `messagesSchema`로 V3 리듀서 채널(`BinaryOperatorAggregate`)에 그대로 꽂힌다. 멀티턴은 V5 자기 루프로.
- **참조:** `graph/message.py`.
- **검증:** addMessages 단위 + 챗봇 누적 + 멀티턴 루프 + 채널 타입 대응. ([노트 12](notes/12-v8-messages.md))

---

## Studio 트랙 (조기·최소, core와 병렬)

Core가 조금이라도 돌면 곧바로 눈으로 관찰. `apps/studio` (`@ariadne/studio`). 각 단계는 core에 필요한 관찰 API를 요구하며 자란다.

- [x] **S1 · 최소 스튜디오** — Bun.serve 로컬 서버(:4111) + 브라우저 UI. 그래프를 mermaid로 시각화 + invoke를 스텝별 실행/관찰.
  - **core를 진화시킴:** `getGraph()`(구조) + `stream()`(스텝 이벤트) 추가. `invoke = stream의 마지막`.
- [x] **S2 · Channels 뷰** — 스텝마다 각 채널의 type/available/value를 패널로. "상태=채널들"을 눈으로. (core에 `BaseChannel.kind` + `ChannelSnapshot` + `stream`이 채널 스냅샷 yield)
- [x] **S5 · 챗 플레이그라운드 + 실제 모델 연결** — `@ariadne/model`을 물려 **진짜 모델이 도는 예제** 2종(`live-chat`, `live-loop`). 기본 `claude-code/sonnet`이라 **API 키 없이** 바로 보인다. UI에서 모델 스펙을 바꿔 200개 프로바이더 중 아무거나 지정할 수 있다.
  - **core를 진화시키지 않았다.** 이번엔 Studio가 요구한 게 없다 — live 예제의 그래프 구조가 기존 예제와 똑같아서, 관찰 API가 그대로 통했다. 그게 F1의 "그래프는 안 바뀐다"가 관찰 층에서도 참이라는 증거다.
  - **지연 생성이 핵심.** 예제 그래프를 import 시점에 만들면 자격증명 없는 환경에서 `model()`이 던져 **스튜디오 전체가 안 뜬다**. `Example.build(spec)`으로 미뤘다. 빌드 실패는 실행 실패와 같은 자리에서 잡아 "어느 환경변수가 필요한지"를 그대로 보여준다.
  - **Chat 탭이 주 화면이다**(mastra 플레이그라운드 대응). 프로바이더 **드롭다운**(200개, "바로 사용 가능"/"키 필요"로 그룹) + 모델 칸 + system 칸 + 대화 로그. 레지스트리가 env 이름을 아니까 고르기 **전에** "GROQ_API_KEY 필요"를 보여준다.
  - **대화도 그래프로 돈다.** `chatTurn()`이 `START→model→END`(messagesSchema)를 세워 `stream()`으로 돌린다 — 그래서 오른쪽 패널에 **이번 턴의 스텝·채널**이 그대로 뜬다. 일반 챗 UI와 갈리는 지점이자, 이 스튜디오가 그래프 엔진의 관찰 도구라는 정체성.
  - 이력은 매 턴 전체를 보낸다(API가 stateless인 것과 같은 이유). 새로 생긴 메시지만 돌려주므로 클라이언트가 이어붙인다.
  - Examples 탭에 기존 갤러리 + live 예제 2종. `PORT` 환경변수로 포트 변경(떠 있는 스튜디오를 안 죽이고 새 코드를 띄우려고).
- [x] **S6 · 조건부 엣지를 그림에** — ReAct 루프도 RAG의 Send 팬아웃도 그림에서 통째로 빠져 있었다(V5가 미룬 `path_map`의 대가). `addConditionalEdges(src, router, targets?)`로 후보를 선언하면 **점선**으로 그린다.
  - **core를 진화시킴:** `GraphView.edges`에 `kind: "static" | "conditional"`, `StateGraph`에 `branchTargets`. V5 노트가 예고한 숙제를 여기서 갚았다.
  - **설계 원칙 둘:** ① `targets`는 그림용일 뿐 **실행·검증에 관여하지 않는다**(라우터가 목록 밖으로 가도 막지 않는다). ② 안 적으면 **안 그린다** — 모르는 걸 지어내면 관찰 도구가 아니다.
  - Send도 같은 방식으로 적는다. "런타임에 정해지는 행선지"라는 점에서 조건부와 구분할 이유가 없다. ([노트 16](notes/16-s6-path-map.md))
- [x] **S7 · 챗 그래프 모양 선택** — 챗이 `START→model→END` 하나에 묶여 있었다. Graph 드롭다운으로 **모양을 골라** 진짜 모델로 돌린다. 대화 내용이 아니라 **엔진 개념**을 하나씩 보여주도록 골랐다.
  - `single` 스텝 1개 · `chain`(draft→revise) 선형 다단계, 스텝 2개 · `parallel`(plain·critical) **한 슈퍼스텝 병렬 + 리듀서 팬인**(V4) · `loop` 자기 루프(V5).
  - **보내기 전에 그림이 뜬다.** `/api/chat/graph?shape=`가 `spec` 없이 그래프를 세워 구조만 준다 — 자격증명이 없어도 모양을 볼 수 있다.
  - S6 덕에 `loop`의 자기 순환이 점선으로 그려진다. 두 단계가 맞물린 지점.
- [x] **S8 · 분업 모양(Send 팬아웃)** — `parallel`이 "같은 질문에 두 관점"이라 **분업이 아니라는** 지적을 받고 추가. `dispatch`가 요청을 하위 작업 N개로 쪼개고 **각 워커가 자기 몫만** 받는다(V6 Send, `addNode<string>`). 패널에 `Step 0: dispatch` → `Step 1: worker · worker`로 뜬다.
  - **claude-code 트랜스포트의 하네스 오염을 측정으로 걷어냈다.** ① 실행 디렉터리의 `CLAUDE.md`·스킬을 자동으로 읽어 저장소 맥락이 실렸다 → 기본 cwd를 임시 디렉터리로. ② `--disallowed-tools`는 실행만 막고 **툴 정의는 컨텍스트에 남긴다** → `--tools ""`로 교체. 프롬프트 토큰 **18,040 → 923**(기본 → `--tools "" --disable-slash-commands --system-prompt`). 지시 준수 **1/3 → 3/3**. `--bare`는 더 강하지만 구독 자격증명을 안 읽어(`Not logged in`) 못 쓴다.
  - 제어 노드(dispatch)는 사용자 System을 **안 물려받는다**. "두 문장 이내" 같은 답변 지시가 계획 형식과 충돌한다.
- [x] **S9 · 에이전트 사이드바** — Mastra 플레이그라운드 대응. 레이아웃을 상단 탭 → **좌측 고정 사이드바**로 바꾸고, `agents: AgentDef[]`에 등록한 에이전트가 사이드바에 뜬다. 고르면 우측에 **설정 칩 + 그래프 + 대화 + 스텝**.
  - **"에이전트 등록"은 배열 한 줄.** `AgentDef`가 `createAgent`(F3.1)의 설정 그대로라 등록 = 설정에 이름 붙이기다(Mastra `new Mastra({ agents })`와 같은 발상). 셋을 골라 `createAgent`의 얼굴을 보여준다 — 툴 여럿·툴 없음(단발 호출)·툴 하나.
  - **core를 진화시키지 않았다.** 에이전트 그래프도 `getGraph()`·`stream()`으로 관찰되는 평범한 그래프라 S1~S2 관찰 표면이 그대로 통했다("agent=특수한 그래프"가 관찰 층에서 회수됨).
  - `/api/agents/graph`는 **preview 모델**로 그려 자격증명 없이 구조가 뜬다. 기본 claude-code/sonnet이라 **API 키 없이** 진짜 에이전트가 돈다(툴이 있으면 promptedTools 자동, 사이드바가 "툴=프롬프트 흉내" 칩으로 알림). 렌더링(`msgHtml`)·IME 처리(`bindComposer`)를 자유 Chat과 공유해 기존 44 테스트 무수정.
  - **실호출 검증(실제 CLI, 키 0):** timekeeper `now()` · calculator `add·multiply` 병렬 → 둘 다 model→tools→model 왕복 성공. ([노트 22](notes/22-s9-agent-sidebar.md))
- [x] **S10 · React + Vite + Tailwind 재구축** — 스튜디오를 배포용 admin 제품으로. 바닐라 `page.ts`(빌드 0) → **React/Vite/Tailwind 빌드 앱**. Mastra 플레이그라운드를 레퍼런스로 삼되 **코드는 안 가져오고 스택·디자인 언어만 차용**(그들 UI는 Mastra 서버 계약에 묶여 죽은 화면이 딸려온다). 좌측 사이드바 + 다크 테마.
  - `apps/studio`를 갈랐다: `src/`(Bun API — **엔드포인트 무수정**, `page.ts`만 삭제 + dist 서빙) / `web/`(React UI). **서버가 UI-무지**였던(S9) 덕에 클라이언트를 통째로 바꿔도 엔드포인트·그 테스트가 살아남았다.
  - UI는 서버 코드를 import 안 함(브라우저 vs Bun) → `web/src/api.ts`가 응답 모양을 다시 적음. mermaid는 CSS `!important` 대신 `themeVariables`로 다크.
  - **제거(정직):** 옛 바닐라 클라이언트 JS 문자열을 검사하던 가드들 — 대상이 `.tsx`로 옮겨가 사라짐(로직은 컴포넌트에 이식). biome CSS 파서에 `tailwindDirectives` 켬.
  - **헤드리스 크롬으로 실제 렌더 확인.** 256 pass / 4 skip. ([노트 23](notes/23-s10-react-studio.md))
- [x] **S11 · 스튜디오 × MCP** — F3.2가 남긴 스튜디오 연동. 사이드바에 MCP 에이전트 둘: `mcp`(우리 데모 stdio 서버 — **네트워크 0 · 키 0**)와 `filesystem`(**남이 만든** 공식 `@modelcontextprotocol/server-filesystem`에 npx로). 툴 칩에 `🛰 MCP: <서버이름>` 출처 표식.
  - **화면 쪽이 거의 안 바뀐 게 결과다.** `agentInfo`·`buildAgentGraph`·`agentTurn` 무수정 — 전부 `def.tools`만 읽고 그게 어디서 왔는지 모른다. 추가된 건 `AgentDef.mcp` 선언 한 필드 + 시작 시 채우는 `connectMcpAgents()`뿐이라 **MCP를 아는 파일이 `agents.ts` 하나로 갇힌다.**
  - **연결 수명은 앱이 쥔다** — `connectMcpAgents()`가 정리 함수를 반환하고 `server.ts`가 SIGINT에서 부른다(F3.2의 "가변 상태는 연결에 있다"가 앱 층에서 재확인 → `createAgent`는 계속 상태 없는 함수).
  - **한 서버가 안 떠도 스튜디오는 뜬다** — 서버별 try/catch, 실패는 `mcpError`로 UI에 원문 노출. 데모 서버는 픽스처를 **일부러 복제**(남의 패키지 `test/`를 런타임에 spawn하지 않는다).
  - 296 pass / 4 skip — **스튜디오 밖 다섯 패키지 무수정.** ([노트 25](notes/25-s11-studio-mcp.md))
  - **벽 → 다음:** `filesystem` 서버는 `edit_file`·`write_file`도 준다. 막을 자리가 없어 `mcp-sample/` 한 폴더로 좁힌 건 **정책이 아니라 회피** → F3.3 승인 게이트.
- [x] **S12 · 승인 UI** — F3.3의 게이트에 **누를 버튼**을 붙인다. 툴 칩에 `🔒`, 멈추면 승인 패널(대기 호출 + 인자 + `승인하고 실행`/`거부`), 멈춘 동안 컴포저 잠금.
  - **재개에 새 엔드포인트가 안 생겼다** — `POST /api/agents/chat`에 `decision` 필드 하나. 세션 id도 `/resume`도 서버 쪽 대기 테이블도 없다. S5부터의 무상태 규약("이력 전체를 받고 새로 생긴 것만 돌려준다")이 **고칠 필요 없이 그대로 재개 규약**이 됐다. UI에서도 보내기와 재개가 같은 함수다.
  - **유일하게 새로 생긴 계약은 응답의 `pending`** — 멈추면 새 메시지가 0개라(F3.3: "ask는 아무것도 안 쓴다") 이게 없으면 클라이언트가 멈춤과 빈 응답을 구별 못 한다. **안쪽에선 부재로, 경계 밖에선 존재로** 표현되는 같은 사실.
  - **`AgentDef.approval`은 함수가 아니라 문자열 배열** — 사이드바로 직렬화돼야 하므로. `buildAgentGraph` 한 곳에서만 `askFor(names)`로 함수가 된다. **S11의 `mcp` 필드와 같은 모양**이라 이제 앱의 규칙이다: 등록 목록엔 데이터만, 살아있는 것은 부팅 코드에.
  - **한 번의 승인은 그 묶음만 연다**(정책 클로저가 결정을 1회만 쓰고 버린다 — 안 그러면 한 번 승인이 그 뒤를 다 열어준다). `"ask"`는 클라이언트가 못 보낸다(무한 왕복). 안 붙은 툴은 "승인 필요"에서 뺀다(서버가 안 떠도 거짓말 안 함).
  - **S11의 회피를 거뒀다** — `filesystem` 에이전트의 쓰기 툴 4종이 승인 대상. 폴더 범위는 이중 방어로 남긴다. **어느 툴이 위험한지 MCP는 안 알려줘서** 목록은 손으로 적는다(한계).
  - **손 확인:** 기성 filesystem 서버로 "메모 저장" → 안전한 `list_allowed_directories`는 조용히 돌고 `write_file`에서 멈춤 → 거부하면 파일 안 생기고 모델이 대안 제시 → 같은 대기에서 승인하면 생성. 헤드리스 크롬으로 UI 렌더·클릭까지 확인.
  - 315 pass / 4 skip (studio 46 → **52**, 그중 2는 진짜 모델로 멈춤·재개). ([노트 27](notes/27-s12-studio-approval.md))
  - **벽 → 다음:** 승인이 **한 run 안에서만** 산다 — "이번만 허용"은 되는데 "항상 허용"이 안 된다. 그러려면 대화가 아니라 **사용자에게 붙는 상태**가 필요하고, 그건 서버가 대화를 소유한다는 뜻이다 → 세션 · **F4 메모리 링**.
- [x] **S13 · 메모리 뷰** — F4.2가 목표 장면을 달성했는데 **화면에선 모델이 갑자기 다르게 군 걸로만 보였다.** 사실이 `system`에 접혀 들어가 모델만 보고, `GET /api/memory`를 읽는 화면이 하나도 없었다(`web/src`에 `memory`라는 단어가 한 번도 안 나왔다). 관찰 도구에 뚫려 있던 관찰 구멍.
  - **질문이 둘이라 자리도 둘이다** — "이번 턴에 어느 기억을 썼나"(대화 바로 위 띠 = 이번 run의 전제)와 "지금까지 무엇이 쌓였나"(아래 전체 폭 = 역사). 합치지 않았다.
  - **주입은 응답에만 실을 수 있었다.** `injections` 행에 남지만 그걸 에피소드로 되짚는 조회가 없고 만들 이유도 없다(클라이언트는 방금 자기가 부른 턴을 묻는다). → `AgentReply.injected` 필드 하나. **S12의 `pending`과 같은 모양**이고(안쪽에선 부재, 경계 밖에선 존재), 없으면 **키를 아예 안 만든다**(F2.1의 규칙). 새 엔드포인트 0 · `/api/memory` 무수정.
  - **곁다리로 `finished` 플래그가 사라졌다** — 판정(`judge`)을 `finally`에서 성공 경로로 끌어올리니 "끝까지 돌았나"가 `outcome`의 부재로 그냥 표현된다. **DB에 쓰는 값과 응답에 싣는 값이 같은 변수**가 돼 어긋날 자리가 없어졌다.
  - **띠의 숫자는 `주입 전 성적`이다** — 응답의 사실은 턴 시작에 읽은 것(그걸로 골랐으니까), 아래 표는 끝난 뒤 읽은 것이라 한 칸 앞선다. 맞추는 대신 **라벨에 시점을 적었다**. 억지로 맞추면 무엇으로 골랐는지가 사라진다.
  - 패널이 세 블록인 건 **쌓이는 조건이 달라서**다(사실=임계 넘을 때 · 가치 신호=버튼 누를 때 · 에피소드=매 run 무조건). 사실 표에 `origin`과 `trials`/`strength`를 한 줄에 놓아 **F4.3의 벽이 숫자로 보인다** — 실측에서 사건형·선호형이 나란히 `+1`.
  - **실호출 검증(진짜 모델, 키 0):** `injected.outcome: "reinforce"` · `steps: [["model"]]`(툴 노드에 아예 안 감). 헤드리스 크롬으로 렌더·클릭까지.
  - 351 pass / 3 skip (studio 31 → **34**) — **스튜디오 밖 여섯 패키지 무수정.** ([노트 31](notes/31-s13-memory-view.md))
  - **벽 → 다음:** 이제 F4.3의 동률이 화면에서 읽힌다. 가르려면 먼저 `[기억한 것]` 틀이 교란 변수인지 재봐야 한다.
- [ ] **S3 · 스텝 하이라이트/재생** — 실행 중 현재 노드를 그래프에서 강조, 스텝 넘기기. **→ S14에서 갚는다.** 지금까지 미뤄진 이유는 "현재 노드"를 놓을 **시간 축이 없어서**다(`StepUpdate`에 시각이 없다). F6.1이 `startedAt/endedAt`을 심으면 그 축이 생긴다.
- [x] **S4 · 예제 그래프 갤러리** — 큐레이션된 예제 5종을 드롭다운으로 선택/관찰(linear/grow/accumulate/preserve/long). (사용자 파일 로드는 이후)
- [ ] **S14 · 트레이스 뷰 — 그리고 S3를 갚는다** (F6.2 직후) — 스팬 타임라인/플레임 뷰 + 그래프에서 현재 노드 하이라이트·스텝 재생. 스텝을 클릭하면 `tasks[].writes`로 **"이 노드가 쓴 것"**이 갈려 보인다(오늘은 합쳐진 결과만 보인다). `GET /api/threads/:id/traces`. F6.2 메모리 수집기의 완료 기록을 자체 저장소에 영구 보관하고, 성공·실패 run 모두 조회한다. 외부 전송은 범위에 없다.
  - **안 하는 것:** 타임트래블 재실행 — 체크포인트는 F5.3에 쌓여 있지만 과거 스텝으로 되돌려 다시 돌리는 건 **실이 요구할 때** 만든다.
- [ ] **S15 · 실 뷰** (F9.3 직후) — 왼쪽에 베이스라인 궤적들(겹쳐 그린 히트맵), 오른쪽에 응고된 그래프, 아래에 성적표 비교. **"미로를 헤맨 발자국 → 길"**을 한 화면에서 본다.
- 이후 core가 커지면: 채널/superstep 상태 관찰 등.

---

## Framework 트랙 (V8 이후 — core 위에 얹는 링)

Core 트랙이 V8로 끝났다. 여기부터는 **엔진을 안 건드리고 그 위에 링을 두른다.** 순서는 [VISION.md](VISION.md)의 `model → tools → agent → memory`이고, 규칙은 Core 트랙과 같다 — 한 커밋 = 한 단계, 매 단계가 돌아간다, 벽이 부를 때 도입.

**링의 경계:** `@ariadne/core`는 **런타임 deps 0을 계속 유지**한다. LLM/서드파티 SDK는 링에만 산다(VISION). 엔진은 링을 모르고, 링은 core의 공개 API만 쓴다.

### F1 · 모델 링 — ChatModel + Anthropic 어댑터 — [x] 완료
- **도는 것:** 챗봇 그래프의 `model` 노드가 **진짜 Claude를 부른다.** V8 캡스톤에서 가짜 함수였던 자리가 그대로 교체된다 — **그래프 구조는 한 글자도 안 바뀐다.**
- **내부:** `packages/model`(`@ariadne/model`). 프로바이더 중립 `ChatModel { provider, modelId, invoke(messages, options) → AIMessage }` + `anthropicChat()` 어댑터. 번역이 필요한 지점은 정확히 둘 — **역할 이름**(human→user, ai→assistant)과 **system의 위치**(core는 대화 리스트 안, Anthropic은 분리된 최상위 파라미터). 응답 id를 `AIMessage`에 실어 V8 `addMessages`의 교체 의미와 맞물린다.
- **새 개념:** `ChatOptions`(프로바이더 공통으로 의미가 통하는 것만), `CreateMessage`(호출 함수 주입점 — 테스트가 캐스팅 없이 가짜를 꽂는다), `EmptyConversationError`, `ModelRefusalError`(**거절은 HTTP 200이라 SDK가 안 던진다**).
- **안 한 것(정직):** 스트리밍, 툴 호출(F2), 레지스트리/라우팅(프로바이더가 **하나뿐**이라 미리 만들지 않는다 — 둘째가 생길 때 추출), `temperature`(현행 Claude가 400으로 거부 → 중립 어휘에 들어올 자격이 없다).
- **검증:** 순수 변환 단위 + 가짜 호출자로 어댑터 동작 + **그래프 통합**(누적·멀티턴 자기 루프) + 키 있을 때만 도는 실호출(없으면 skip → 오프라인에서도 `verify` 그린). ([노트 13](notes/13-f1-model.md))
- **벽 → 다음:** `BaseMessage.content`가 **string**이라 `tool_use`/`tool_result`를 담을 수 없다. ReAct 예제의 툴 호출이 아직 문자열 규약(`"도구호출: calc"`)인 이유다.

### F1.5 · 모델 라우터 — 프로바이더 190여 개 — [x] 완료
- **도는 것:** `model("openrouter/anthropic/claude-sonnet-4.5")` — **문자열 하나로 어느 프로바이더든** 고른다. 그래프 코드는 안 바뀐다.
- **핵심 발견:** "프로바이더 200개 지원"의 실체는 어댑터 200개가 아니라 **와이어 포맷 두 개 + 표**다. models.dev 레지스트리 213개를 분류하니 **190개가 OpenAI 호환**, 9개가 Anthropic 포맷이었다. 나머지 차이는 전부 `baseURL`과 환경변수 이름 — 즉 **데이터**다.
- **내부:**
  - `openaiCompatible()` 어댑터 하나가 OpenRouter·Groq·DeepSeek·xAI·Mistral·Together·Cohere·Ollama… 190개를 덮는다. **Gemini도 여기 들어간다** — 네이티브 포맷은 다르지만 구글이 OpenAI 호환 셰임 엔드포인트를 공식 제공한다. **baseURL이 프로바이더를 정한다.**
  - `anthropicChat`에 `baseURL` 추가 → MiniMax·Kimi 등 Anthropic 포맷 프로바이더 9개가 공짜로 붙는다. 이 어댑터는 "Anthropic 전용"이 아니라 **"Anthropic 와이어 포맷" 어댑터**였음이 드러난다.
  - `resolveSpec`(순수) — 첫 `/`까지가 프로바이더, **나머지 전부가 모델 ID**(게이트웨이는 모델 ID에 슬래시가 또 있다).
  - `scripts/sync-providers.ts` → `src/registry.generated.ts`. **빌드타임 생성 + 커밋** — 런타임 네트워크 0, 오프라인에서도 `verify` 그린. (mastra는 런타임 fetch — 반대 트레이드오프를 골랐다.)
- **새 개념:** `ProviderEntry`(format·api·env) · `UnknownProviderError` · `UnsupportedProviderError` · `MissingApiKeyError`(**어느 환경변수가 필요한지 이름을 말한다**).
- **한 가지 함정:** models.dev의 `npm` 필드는 *와이어 포맷*이 아니라 Vercel AI SDK 패키지명이다. 그대로 믿으면 OpenRouter·Groq·xAI·Gemini가 미지원으로 떨어진다 → 각 프로바이더 문서를 확인해 오버라이드 표(12개)를 뒀다.
- **잡은 버그:** models.dev는 워크스페이스별 URL을 `${VAR}` 템플릿으로 준다. 이걸 안 읽어 ① baseURL에 플레이스홀더가 남고 ② `env` 첫 값(=URL 조각)을 API 키로 집고 있었다 → `ProviderEntry.apiVars`로 **URL 조각과 키를 분리**. Databricks·Snowflake·Cloudflare·Neon·Infomaniak 5개가 실제로 부를 수 있게 됐다. (biome 경고를 "생성물이니 무시"로 처리했던 게 실은 이 버그를 가리키고 있었다.)
- **안 한 것(정직):** Vertex·Bedrock·Azure(14개 미지원 — 전부 **인증 방식이 baseURL로 안 덮이는** 것들이다: AWS 서명 · GCP ADC), 스트리밍, 모델 ID 목록(7,560개는 아직 필요 없다 — 프로바이더 메타데이터만 생성).
- **검증:** 순수 파싱 · 라우팅(네이티브/게이트웨이/Anthropic 포맷 타 프로바이더) · 키 없을 때 에러 메시지 · 레지스트리 불변식(포맷은 둘뿐) · OpenAI 어댑터 · 그래프 통합. 키 있을 때만 도는 실호출 2종. ([노트 14](notes/14-f1_5-model-router.md))
- **벽 → 다음:** F1과 동일 — `BaseMessage.content`가 string이라 툴 호출을 못 담는다.

### F1.6 · 인증 계층 (진행 중)
API 키 하나로 표현되지 않는 자격증명을 다룬다. `ProviderEntry`가 "키 + baseURL"까지만 알아서 생긴 구멍이다.

- [x] **SDK 자격증명 해석 허용.** `model()`이 env에 키가 없으면 **SDK를 부르기도 전에** 던지고 있었다. 그런데 Anthropic SDK는 `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → `ant auth login` **OAuth 프로필** → WIF 순으로 스스로 찾는다 — 레지스트리가 아는 환경변수는 그중 **하나일 뿐**이었다. 우리가 SDK보다 엄격해서 나머지 경로를 막고 있었던 셈. `SDK_RESOLVES_CREDENTIALS`(본가 + baseURL 미지정)면 판단을 SDK에 넘긴다. 대가: 정말 자격증명이 없으면 생성 시점이 아니라 **첫 호출**에서 터진다.
- [ ] **Azure** — URL이 `{resource}/deployments/{deployment}?api-version=` 구조. 이미 쓰는 `openai` SDK의 `AzureOpenAI` 클래스로 가능(새 의존성 0).
- [ ] **Bedrock** — AWS SigV4 서명. 공식 `@anthropic-ai/bedrock-sdk`.
- [ ] **Vertex** — GCP ADC. 공식 `@anthropic-ai/vertex-sdk`.

셋을 붙이면 **204/213**. 남는 건 watsonx·SAP·Cloudflare Gateway 같은 엔터프라이즈 케이스.

> **정액제 플랜은 이미 다 된다.** Alibaba·Tencent·MiniMax·Kimi·Xiaomi·StepFun 등의 coding/token plan 20개는 **API 키를 주는 구독**이라 F1.5 구조에 그대로 맞는다(`model("minimax-coding-plan/MiniMax-M2")`). 인증 계층이 필요한 건 키가 아닌 자격증명을 쓰는 쪽이다.

### F1.7 · Claude Code 트랜스포트 — [x] 완료
- **도는 것:** `model("claude-code/sonnet")` — **API 키 없이** 구독 자격증명으로 그래프가 돈다. 프레임워크를 통한 **첫 실호출 검증**이 여기서 났다.
- **핵심:** 앞의 두 어댑터는 *와이어 포맷*이 달랐다(Anthropic vs OpenAI). 이건 **트랜스포트**가 다르다 — HTTP를 안 타고 `claude` 바이너리를 spawn한다. 자격증명을 우리가 만지지 않는 게 요점: CLI가 자기 것을 쓴다.
- **의존성 0으로 구현.** 처음엔 `@anthropic-ai/claude-agent-sdk`로 짰는데 플랫폼 네이티브 바이너리가 **220MB**였다. CLI를 열어보니 `claude -p --output-format json`이 필요한 걸 그대로 준다 — SDK는 그걸 감싼 것이라 단발 왕복엔 `spawn`으로 충분했다. (세션·툴·승인 게이트를 살릴 때 SDK가 값을 한다 → F3)
- **하네스를 ChatModel로 좁히기:** print 모드 · 내장 툴 전면 차단 · `--system-prompt`로 Claude Code 페르소나 제거. 프롬프트는 **stdin**으로(인자는 길이·이스케이프 문제).
- **손실(정직):** `-p`는 문자열 하나만 받으므로 대화를 텍스트로 직렬화한다 — 모델이 보는 건 진짜 대화 구조가 아니다. 진짜 멀티턴은 세션이 필요하고 `ChatModel`보다 큰 인터페이스를 요구한다(F3). **id도 안 싣는다** — `session_id`를 메시지 id로 쓰면 같은 세션의 답변끼리 서로를 덮어쓴다(V8 교체 규칙).
- **깨진 불변식:** "어댑터는 둘뿐"이 이제 틀렸다. 의미를 나눠 고쳤다 — HTTP 프로바이더의 *와이어 포맷*은 여전히 둘, 세 번째는 *트랜스포트*가 다른 하나. `claude-code`는 `env: []`라 "모든 엔트리가 인증 방법을 안다"에도 예외가 생겼다(자격증명이 우리 밖에 있다).
- **검증:** 56 pass / 3 skip. 순수 함수 3종 + 어댑터 + 그래프 통합 + **실호출**(CLI 없으면 skip). ([노트 15](notes/15-f1_7-claude-code.md))

### F2 · 툴 링 — 세 커밋
F1의 벽(`content`가 string이라 툴 호출을 못 담음)을 정면으로 받는다. **모델 링까지 함께 바뀐다** — 어댑터 셋을 전부 손대고 그중 하나는 거부해야 한다(작업량의 절반이 와이어 층이다). 도착점은 **문자열 규약 없이 도는 진짜 ReAct 루프**.

#### F2.1 · 툴 호출 왕복 (core 어휘 + 두 어댑터) — [x] 완료
- **도는 것:** `bun run --filter '@ariadne/model' example:tools` — 진짜 모델이 `tool_use`를 돌려주고, 예제가 계산해 `tool` 메시지로 되돌려주면 모델이 최종 답을 낸다.
- **예고를 뒤집었다.** 이 문서는 원래 "`content`를 블록 배열로"라고 적었는데, **안 넓혔다.** `content: string`을 유지하고 `AIMessage.toolCalls?` + `"tool"` 역할을 **곁들임 필드**로 더했다 — LangChain이 실제로 쓰는 방식이고(`messages/ai.py`의 `tool_calls`는 content의 형제 필드다), blast radius가 7파일 → 0이다. 그 결과 **F2도 V8과 같은 성질**이 됐다: 어휘만 넓어지고 `addMessages`도 채널도 엔진도 안 움직인다. 남은 빚은 멀티모달 — 이미지 블록이 부를 때 `content`를 넓힌다.
- **회귀 0의 조건:** 새 필드는 **비면 키를 아예 안 만든다**(`id`가 쓰던 수법). 기존 테스트 ~7파일이 메시지를 통째로 `toEqual` 비교하므로 빈 배열이라도 실으면 전부 깨진다.
- **번역 지점이 셋이 됐다.** F1의 둘(역할 이름 · system의 위치)에 **툴 결과의 묶음 단위**가 더해진다 — Anthropic은 한 턴의 결과를 **user 메시지 하나의 블록들**로, OpenAI는 **독립 `role:"tool"` 메시지 낱개**로 받는다. 중립형은 "결과 1개 = 메시지 1개"(`addMessages`가 주소를 붙일 수 있는 단위가 메시지라서)이고, **묶는 건 어댑터가** 한다. 넷째 비대칭은 인자 — 객체 vs **깨질 수 있는 JSON 문자열**(→ `ToolCall.invalidArgs`로 원문 보존, 던지지 않는다).
- **`claude-code`는 툴을 못 쓴다.** `-p`는 `result` 문자열 하나뿐이고 `--tools`는 내장 툴 목록이라 호출자 정의 툴을 실을 자리가 없다(유일한 경로 `--mcp-config`는 실행이 `ChatModel.invoke` 밖이다 → F3). `ChatModel.supportsTools`로 드러내고 **던진다** — 조용히 무시하면 모델이 산문으로 답해 그래프가 영영 툴 노드로 안 간다.
- **잡은 조용한 오작동 둘:** 역할이 4개로 늘며 `claudeCode`의 단일 턴 지름길(`role !== "system"`)이 tool 결과를 집고, `openaiCompatible`의 빈 대화 가드가 `[system, tool]`을 통과시켰다. 둘 다 타입 에러가 아니라 논리 구멍이다.
- **검증:** 207 pass / 3 skip / 0 fail (core 81 · model 88 · **studio 38 무수정**). ([노트 17](notes/17-f2_1-tool-calls.md))
- **벽 → 다음:** 스키마를 손으로 쓰고(TS 타입과 드리프트), 인자를 그냥 믿고, id를 손으로 맞춘다.

#### F2.2 · `@ariadne/tools` — 정의(zod)와 실행(toolNode) — [x] 완료
- **도는 것:** `bun run --filter '@ariadne/tools' example` — 가짜 모델이 한 턴에 툴 둘을 부르고, `toolNode`가 병렬로 돌려 결과 둘을 id 순서대로 낸다. **자격증명 0 · 네트워크 0.** 가짜 모델인 게 요점이다 — 검증 대상이 툴 프로토콜이라 결정론적이어야 관찰이 된다.
- **새 엔진 기능이 없다.** `toolNode(TOOLS)`는 그냥 `NodeFn`이라 `addNode`에 꽂히고, 병렬은 `Promise.all`이, 상태·제어흐름 갱신은 **V7의 `Command`**가 맡는다. **core는 한 글자도 안 바뀌었다.**
- **의존 간선이 안 늘었다.** `@ariadne/tools`는 `@ariadne/model`을 **import하지 않는다** — `toolSpecs()`의 결과가 `ToolSpec`과 **구조적으로 같을 뿐**이고, 호환을 기계적으로 검사하는 자리는 둘 다 의존하는 `apps/studio`의 `tsc`다. 그 대가로 이 링은 **SDK도 모델 링도 모르는 순수 링**으로 남는다.
- **zod의 경계는 한 문장이다: "채널에 사는 것만 core에 둔다."** `ToolCall`은 messages에 실려 다니니 core, 툴 선언(JSON Schema)은 프로바이더용 산출물이라 링. core는 여전히 deps 0.
- **`io: "input"`이 맞다(계획을 실측으로 뒤집음).** 기본값 `"output"`으로 뽑으면 `.default()`가 붙은 필드가 `required`에 들어가 **기본값이 있는데도 모델에게 반드시 보내라고 말한다.** 대가로 `additionalProperties: false`가 빠지지만 zod로 다시 검증하므로 손해가 없다(OpenAI `strict`도 안 켠다 — `.optional()`과 바로 충돌한다). `$schema`는 항상 붙고 끄는 옵션이 없어 한 줄로 뗀다.
- **에러 정책이 핵심 판단.** 모델이 잘못 준 인자는 **에러 메시지로 돌려줘 스스로 고치게** 하고(없는 툴 이름 → 쓸 수 있는 목록 · 깨진 JSON → 원문 · 스키마 위반 → 어느 인자가 왜), **툴 본문이 던지면 전파**한다. 노브(`handle_tool_errors`)는 두 번째 소비자가 생길 때.
- **못박은 성질 둘:** ① **`Command.goto`는 더하기다** — `END`는 아무 채널에도 안 쓰고 정적 엣지는 무조건 쓰는 writer라, `goto: END`로는 정적 엣지를 취소하지 못한다(V7에서 구조적으로 나온다). ② **툴 둘이 messages 밖 같은 키를 쓰면 나중 것이 이긴다** — `NodeReturn`이 단일 값이라 채널 리듀서에 닿기 전에 충돌한다(langgraph는 Command 리스트로 피한다).
- **안 옮긴 것(명시):** 주입 상태·스토어 — 그리고 거기 딸린 **인자 강제 제거**(안 하면 프롬프트 인젝션 구멍이라, 나중에 넣을 때 **옵션이 아니라 필수**다). 그 외 스트리밍 · `return_direct` · `remaining_steps` · 훅 · `ValidationNode` · 예외 타입 추론 · sync/async 이중화.
- **검증:** 28 pass. 전체 235 pass / 3 skip / 0 fail (core 81 · **tools 28** · model 88 · studio 38 — 앞의 셋 무수정). ([노트 18](notes/18-f2_2-tools-ring.md))
- **벽 → 다음:** 스튜디오의 `react`가 여전히 문자열 규약으로 거짓말을 하고, 진짜 모델은 이 링을 통해 아직 툴을 안 불렀다.

#### F2.3 · 스튜디오 — 문자열 규약을 걷어낸다 — [x] 완료
- **도는 것:** `bun run studio` — 갤러리의 `react`가 진짜 `toolCalls`/`tool` 메시지로 돌고(한 턴에 툴 둘 → 병렬), `react-repair`가 스키마 위반 → 에러 메시지 → 자가 수정을 보여주며, **Chat 탭에 `tools` 모양**이 생겨 진짜 모델이 툴을 고른다. 앞의 둘은 여전히 **자격증명 0 · 네트워크 0**이다.
- **노트 18이 예고한 검사가 발동했다.** `@ariadne/tools`의 `ToolSpecShape`를 `@ariadne/model`의 `invoke({tools})`에 넘기는 **한 줄**이 그 자리다. `description`의 필수/옵셔널 방향이 맞고, 양쪽 `JSONSchemaObject`의 인덱스 시그니처 덕에 모델 쪽에만 있는 `additionalProperties?: boolean`도 안 걸린다 — **통과.** 링을 서로 모르게 둔 값을 여기서 회수했고, 이제 `bun run typecheck`에 상시로 걸린다.
- **루프를 조건부 엣지로 끊지 않는다(핵심 판단).** 툴 호출이 실린 AI 메시지를 남긴 채 END를 고르면 답 없는 `tool_use`가 이력에 남아 **다음 턴이 400**이다(챗은 이력을 계속 이어붙인다). 대신 마지막 호출에 **툴 선언을 안 준다** — 못 부르니 산문으로 답하고 `toolsCondition`이 자연히 END를 골라 이력이 항상 온전하게 끝난다. **엣지로 지킬 수 없는 불변식이 있다.**
- **가짜 모델이 상태를 들면 안 된다.** 스튜디오는 컴파일된 그래프를 캐시해 여러 번 돌리므로, `packages/tools`의 CLI 예제가 쓰는 턴 카운터를 그대로 옮기면 Invoke 두 번째 클릭이 다르게 구른다. 두 예제 모두 **마지막 툴 결과 하나**만 보고 다음 수를 정한다 → 재실행 안전.
- **`supportsTools`가 UI까지 올라왔다.** `ProviderInfo.tools`를 `format !== "claudeCode"`로 뽑아 **모델을 만들어 보지 않고** 미리 경고한다(기본 프로바이더가 하필 claude-code라 처음 고르는 사람이 대개 걸린다). 경고는 하되 버튼은 안 막는다 — 실제로 보내면 어댑터가 왜 못 하는지까지 적어 돌려주고, 그게 가르치려는 것이기도 하다.
- **회귀 안전망의 첫 예외(예고대로).** `"도구호출: calc"` assert 둘을 대체했다. 안전망을 깬 게 아니라 **안전망이 지키던 대상이 사라졌다** — 그건 엔진의 성질이 아니라 자리를 메우던 문자열이었다. 엔진 성질을 지키던 assert(스텝 수·리듀서·채널 타입·path_map)는 하나도 안 건드렸다.
- **잡은 것:** 툴을 부르는 AI 메시지는 `content`가 비어 있어서 챗 로그가 **빈 말풍선**을 그리고 있었다 → `toolCalls`와 `toolCallId`를 렌더(호출↔결과 짝이 이 단계에서 눈으로 볼 유일한 값이다).
- **안 한 것(정직):** 진짜 모델의 툴 호출은 **이 환경에서 확인 못 했다**(claude-code는 툴 불가 + API 키 없음). 실호출 테스트는 `skipIf(!ANTHROPIC_API_KEY)`로 써두고 건너뛴다(F1.7의 CLI 스킵과 같은 방식). 그 외 툴 승인 게이트 · 스트리밍 · 주입 상태 없음.
- **검증:** 241 pass / 4 skip / 0 fail (core 81 · tools 28 · model 88 — 앞의 셋 무수정 · **studio 44**). ([노트 19](notes/19-f2_3-studio-tools.md))
- **벽 → 다음:** `model ⇄ tools` 조립 네 줄이 세 곳에서 똑같이 반복된다. **그게 F3의 동기**이고, 반복이 정확히 네 줄이라는 사실이 "에이전트 = core 위의 특수한 그래프"라는 F3의 제약을 이미 증명한다.

#### F2.4 · claude-code 프롬프트 툴 심 — 우리 링이 실행하는 텍스트 기반 툴 호출 — [x] 완료
- **도는 것:** `bun run studio` → Chat에서 **claude-code/sonnet + tools 모양**. **API 키 0**으로 진짜 툴 루프가 돈다(라이브 확인: 한 턴 툴 호출 · 두 툴 병렬 호출 모두 왕복 성공).
- **핵심을 잣대로 길을 갈랐다.** "각 스텝 가시화 + 워크플로우 제어"가 유지되려면 **툴 루프가 우리 그래프 안**에 있어야 한다. MCP는 네이티브지만 루프를 claude 프로세스 안으로 넘겨 이 핵심을 깬다(스텝 안 보임·제어 놓침 → 그건 F3의 SDK 위임 방향). claude-code를 모델로 유지하며 핵심을 지키는 유일한 길이 **길 B — 프롬프트 심**이다.
- **어댑터 층에서 편다·되살린다.** `renderToolProtocol(specs)`가 툴을 시스템 프롬프트에 텍스트로 풀고, `parsePromptedToolCalls(text)`가 모델의 텍스트를 `ToolCall[]`로 되살린다. 그 뒤 `toolsCondition`/`toolNode`는 **한 글자도 안 바뀐 채** 돈다 — 실행도 라우팅도 우리 링·엔진.
- **opt-in이라 회귀 0.** `promptedTools`는 `ClaudeCodeConfig` 옵션이고 **기본 꺼짐** → tools를 주면 던지던 F2.1 동작·`supportsTools===false` 테스트가 그대로 그린. 켰을 때만 `supportsTools`가 true가 되고 심이 돈다. `supportsTools`의 뜻("와이어가 툴 정의를 실을 수 있나")도 지킴 — 프롬프트가 와이어면 실을 수 있으니 true가 맞다.
- **잡은 구멍:** 툴을 부르는 ai 메시지는 `content`가 비어(호출은 toolCalls에 있음) `toPrompt`가 2턴째에 "Assistant: "(빈 줄)만 남겨 **모델이 자기 이전 행동을 못 봤다** → toolCalls를 규약과 같은 JSON으로 되살려 편다(네이티브 모드엔 안 타므로 기존 테스트 무변).
- **정직(대가 셋):** ① **id를 우리가 만든다**(프로바이더가 안 주므로 `call_1`… — 텍스트 이력이라 턴 간 재사용 무해). ② **와이어 스키마 강제 없음** → zod가 toolNode에서 사후 검증, 깨진 인자는 `invalidArgs`로 보존, `stripFence`로 ```json``` 흡수. ③ **파싱은 최선 노력**(통째 → 바깥 `{…}` 재시도). 네이티브보다 덜 튼튼하고, UI가 "흉내 모드"임을 알린다(막지는 않음).
- **스튜디오:** `buildChatGraph`가 tools 모양에서 **모든** 프로바이더에 `promptedTools`를 켠다(네이티브는 무시, claude-code만 흉내 → 분기 불필요). F2.3의 "못 쓴다/던진다" 경고를 "프롬프트로 흉내 낸다/덜 안정적" 안내로 바꿨고, 이 세션 F2.3에서 추가했던 "claude-code+tools → 500" 테스트를 **대체**했다(회귀가 아니라 전제가 바뀜).
- **검증:** 250 pass / 4 skip / 0 fail (core 81 · tools 28 무수정 · **model 97** · **studio 44**). ([노트 20](notes/20-f2_4-claude-code-prompted-tools.md))
- **벽 → 다음:** 네 어댑터 전부가 툴 루프에 참여한다(셋 네이티브 + 하나 심). 조립 네 줄이 여전히 세 곳에서 반복 → **F3의 동기**. 그때도 루프는 우리 엔진 안(이 커밋이 지킨 핵심).

### F3 · 에이전트 링 — `@ariadne/agent`
model+tools 자율 루프. **agent = core 위의 특수한 그래프**라는 걸 보이는 단계 — 새 실행 개념 없이 StateGraph 조립으로 끝나야 한다. **루프는 우리 엔진 안에 남는다**(F2.4가 MCP 위임과 갈라 지킨 핵심). MCP/세션/승인 게이트로 claude-code를 확장하는 SDK 경로는 여기서 다룬다.

> **MCP는 방향이 셋이다.** ① 남의 서버의 툴을 우리가 쓴다(client — **F3.2**) ② 우리 에이전트/툴을 남에게 노출한다(server — VISION 4번 "연동", 나중) ③ 모델에게 루프째 위임한다(**F2.4가 거부**). F3.2가 한 건 ①이고, 그래서 루프가 우리 안에 남는다.

#### F3.1 · `createAgent` — ReAct 네 줄을 접는다 — [x] 완료
- **도는 것:** `bun run --filter '@ariadne/agent' example` — `createAgent({ model, tools })`가 컴파일된 그래프를 돌려주고, 가짜 모델이 한 턴에 툴 둘을 부르면 `toolNode`가 병렬 실행해 되돌린다. **자격증명 0 · 네트워크 0.** 진짜 모델 경로는 스튜디오 챗의 `tools` 모양이 그대로 이어받았다.
- **F3의 논지를 코드로:** F2.3/F2.4가 **네 곳에서 글자까지 똑같이** 쓰던 ReAct 조립(`addNode("tools")`+`addEdge(START,"model")`+`addConditionalEdges(…toolsCondition)`+`addEdge("tools","model")`)을 접었다. 반환이 **`CompiledGraph`**라 스튜디오의 `stream()`·`getGraph()`가 그대로 붙는다 — 에이전트가 특별한 실행기가 아니라 **특수한 그래프**임을 못박는다. `createAgent`는 그 네 줄 **이상을 하지 않는다**(새 채널·superstep·엔진 수정 0).
- **발견 · run 경계 = 마지막 human 메시지.** 종료 불변식(“답 없는 `tool_use`를 이력에 안 남긴다” → 마지막 호출에 툴을 안 준다)을 스튜디오는 `turns` 카운터 채널로 셌는데, 다시 보니 **필요 없었다.** "이번 run에서 툴을 몇 번 불렀나"는 **마지막 human 이후의 `toolCalls` 실린 AI 메시지 수**이고, 그 카운터가 **`messages` 채널 안에 이미 있다.** 그래서 기본 에이전트는 `MessagesState` 하나로 돌고(커스텀 스키마 불필요), 스튜디오의 per-turn `turns`와 **동작이 정확히 같다.** ("채널이 유일한 공유 가변 상태"가 한 번 더 옳았다.)
- **판단 셋:** ① `promptedTools`는 **모델 생성**에 남긴다(트랜스포트 문제이지 루프 문제가 아니다) → 에이전트는 트랜스포트-무지. ② 툴을 줬는데 `supportsTools===false`면 **구성 시점에 던진다**(`ModelCannotUseToolsError`) — 그래프가 조용히 툴 노드에 안 가는 걸 첫 호출이 아니라 세우는 순간 막는다. ③ 툴이 없으면 **단발 호출**(`START→model→END`) — 같은 함수가 모양으로 갈린다.
- **깨진 규칙(의도적):** F2.2의 "링은 서로를 모른다"의 **첫 예외** — 에이전트는 model·tools를 둘 다 import한다(엮는 게 존재 이유). 대신 두 링이 만나는 접점(`toolSpecs()`→`invoke({tools})`)이 **스튜디오에서 이 링으로 이사**했고, 이제 `@ariadne/agent`의 tsc가 검사한다. core는 여전히 deps 0.
- **이관/남김:** 스튜디오 챗의 `tools` 모양은 `createAgent<ChatState>(schema: chatSchema)`로 접었다(langgraph `create_react_agent(state_schema=…)`와 같은 이유). tools 예제·갤러리의 `react`·`react-repair`는 **네 줄과 에러 정책을 보여주는 교보재**라 남겼다(접으면 가르치려는 걸 숨긴다).
- **안 한 것(정직):** MCP/세션/승인 게이트(claude-code SDK 확장 — F3 다음 커밋), 주입 상태·스토어, 스트리밍, 모델 스펙 문자열 오버로드(지금은 `ChatModel`만).
- **검증:** 257 pass / 4 skip / 0 fail (core 81 · tools 28 · model 97 · **agent 7** · studio 44 — core·tools·model·studio 무수정). ([노트 21](notes/21-f3_1-agent-ring.md))
- **벽 → 다음:** 에이전트가 아는 건 **한 번의 자율 루프**뿐이다. 세션(진짜 멀티턴)·승인 게이트·MCP는 `ChatModel.invoke`보다 큰 인터페이스를 요구한다 — F3의 남은 커밋.

#### F3.2 · MCP 링 — `@ariadne/mcp`, 툴 정의의 두 번째 입구 — [x] 완료
- **도는 것:** `bun run --filter '@ariadne/mcp' example` — **진짜 MCP 서버 프로세스**를 띄워 툴 목록을 받아오고, `createAgent`가 그걸 로컬 툴과 **같은 배열에** 담아 ReAct 루프를 돈다. **네트워크 0 · 자격증명 0.**
- **`@ariadne/tools`가 한 줄도 안 바뀌었다.** 계획은 `Tool` 인터페이스가 깨진다고 봤는데 전제 둘 중 **하나만** 깨졌다. ① *파생 방향*은 진짜 뒤집힌다(zod→JSON Schema가 아니라 **서버의 JSON Schema→zod**) — 그런데 `Tool`이 `schema`·`spec`을 **처음부터 별개 필드**로 갖고 있어 방향을 강요하지 않았다. ② *실행 위치*(로컬 함수 → RPC)는 **안 깨졌다** — `execute`의 반환이 `unknown`이고 toolNode가 `await`하므로 비동기 원격 호출이 이미 계약 안에 있었다. 결과: `toolNode`·`toolsCondition`·`createAgent`·엔진 **전부 무수정**.
- **성립 조건은 `z.fromJSONSchema`(zod 4.5).** 없었으면 검증을 포기하거나 JSON Schema 검증기를 따로 들여야 했다. **왕복은 안 시킨다** — 되돌린 zod에서 스키마를 다시 뽑으면 `{type:"integer",minimum:1}`이 `maximum: 9007199254740991`을 달고 나온다(실측). 모델에겐 **서버 원본**이 가야 한다.
- **SDK를 안 쓴다.** 우리가 쓰는 표면이 `initialize`·`tools/list`·`tools/call` 셋뿐이라 감싼 패키지를 들이면 배우려는 프로토콜이 그 안에 숨는다(F1.7의 220MB SDK 판단과 같다). **MCP stdio는 LSP와 다르다** — `Content-Length:` 헤더가 아니라 **개행으로 나뉜 JSON 한 줄**이라, `splitFrames`가 순수 함수로 떨어진다.
- **`isError`는 던지지 않는다.** F2.2 정책("툴 본문이 던지면 전파")과 갈리는데 갈리는 게 맞다 — MCP는 이 필드를 *모델에게 보여주라고* 만들었다. `status:"error"`를 실으려면 결과 메시지를 직접 지어야 해서 `Command`로 돌려주고, 그게 F2.2의 `ToolContext.toolCallId`가 처음 쓰이는 자리다. 던지는 건 **연결·프로토콜 실패**뿐.
- **가변 상태는 에이전트가 아니라 연결에 있었다.** 노트 21은 "MCP가 붙으면 `createAgent`를 클래스로 승격"이라 예고했는데, 얹을 게 **에이전트에 안 생겼다** — 프로세스·버퍼·요청 표·수명이 전부 `McpClient` 안이다. 그래서 **`McpClient`가 이 저장소의 첫 클래스**이고 `createAgent`는 계속 함수다.
- **F2.4가 거부한 MCP와 방향이 반대다.** 그때 거부한 건 `claude --mcp-config`(루프를 남의 프로세스로 넘김). 여기선 **우리가 클라이언트**라 호출 결정은 모델이·실행은 `toolNode`가·라우팅은 우리 엔진이 한다 — 루프는 우리 안(F2.4가 지킨 핵심).
- **경계:** `@ariadne/mcp`는 tools에 의존하고 tools는 mcp를 모른다. 패키지 안도 갈랐다 — `protocol.ts`·`client.ts`(툴 링을 모름) / `tools.ts`(여기만 두 링을 앎).
- **테스트가 진짜 서버를 띄운다.** 가짜 클라이언트로 테스트하면 우리가 상상한 서버만 통과한다 → `test/fixtures/demo-server.ts`에 스펙대로 된 stdio 서버를 짰고, `crash-server.ts`로 **가장 흔한 실패(서버가 안 뜸)**를 재현해 조용한 hang 대신 stderr 실은 에러가 나오는지 본다.
- **안 한 것(정직):** 요청 타임아웃(프로세스 사망은 깨우지만 *침묵*은 매단다) · `tools/list_changed` 구독 · HTTP/SSE·OAuth(SDK가 값 하는 자리) · 리소스/프롬프트/샘플링(`initialize`에 능력을 **하나도 선언 안 한다**) · 이름 충돌 정책 · 멀티모달(`[image …]` 표식으로 접힘) · 스튜디오 연동.
- **검증:** 293 pass / 4 skip / 0 fail (core 81 · tools 28 · **mcp 37** · model 97 · agent 7 · studio 43 — **mcp 뺀 다섯 무수정**). ([노트 24](notes/24-f3_2-mcp.md))
- **벽 → 다음:** 원격 툴이 도는데 **어느 툴이 원격인지 아무도 안 알려주고**, 사람이 **툴 실행을 막을 자리가 없다**(남의 프로세스가 파일을 지우는 툴을 줄 수 있는데도). 그게 F3의 남은 둘 — 승인 게이트 · 세션.

#### F3.3 · 승인 게이트 — 인터럽트 없이 멈추고, 체크포인터 없이 재개한다 — [x] 완료
- **도는 것:** `bun run --filter '@ariadne/agent' example:approval` — 위험한 툴 앞에서 run이 **멈추고**, 같은 이력으로 다시 돌리면 승인/거부에 따라 갈린다. **자격증명 0 · 네트워크 0.** 부수효과가 배열에 남는 툴이라 "승인 안 했으면 안 돌았다"가 말이 아니라 관찰로 나온다.
- **노트 24의 예측이 틀렸다.** "지금 넣으면 재개 못 하는 승인이 된다"고 봤는데, **우리 에이전트는 이미 재개 가능했다** — F3.1의 발견대로 유일한 상태가 `messages` 채널이라 **대화를 돌려주는 것이 곧 체크포인트**다. 그래서 `interrupt()`도 checkpointer도 없이 같은 관찰이 나온다: **멈춤 = 답 없는 `tool_use`를 남기고 run이 끝난다 / 재개 = 같은 이력으로 새 run.** core 무수정, 새 실행 API 0.
- **술어 하나가 진입과 이탈을 둘 다 정한다.** `pendingToolCalls(messages)` — F2.3이 **금지**하던 상태("답 없는 tool_use")를 **의미 있는 상태**로 승격시키자 방향만 반대인 대칭이 나온다: 대기 있음이면 `START→tools`(재개)·`tools→END`(멈춤), 없으면 `START→model`·`tools→model`. 진입이 model이면 안 되는 건 정확성 문제다(그 이력을 되보내면 양쪽 와이어 포맷 다 400).
- **게이트는 실행의 변형이 아니라 실행 앞의 결정** — `gatedToolNode`가 `toolNode`를 감싸서 **`@ariadne/tools` 한 글자도 안 바뀐다**(F3.2와 같은 결과). 세 갈래가 전부 **이력에 무엇을 쓰느냐**로만 갈리고, **`ask`는 아무것도 안 쓴다** — 그게 멈춤의 표현이다.
- **정적 엣지가 하나도 없는 그래프.** 정적 엣지는 취소가 안 되므로(제어흐름=채널 쓰기, 쓰기는 합집합) `tools→model`이 조건부가 된다. **노드는 그대로 둘** — 승인이 새 노드를 안 만든다.
- **판단 셋:** ① 정책은 호출 하나가 아니라 **묶음**을 받는다(절반만 돌리면 이력이 깨지고, 그 상태는 '멈춤'과 구별이 안 된다). `askFor(names)`가 "가장 위험한 호출이 묶음의 등급을 정한다"로 올려 붙인다. ② **비동기 정책 하나가 두 모양을 덮는다** — 터미널은 정책 안에서 `await confirm()`(사람이 루프 **안**), HTTP는 `"ask"`로 멈췄다 다음 요청에서 답(사람이 루프 **사이**). ③ **`deny`는 멈춤이 아니라 그냥 툴 결과**(`status:"error"`) — 모델이 읽고 방향을 튼다.
- **안 한 것(정직):** 거부 사유 전달 · 호출별 결정 · 인자 수정 후 승인 · **스튜디오 UI(S12)** · 영속성(재개가 "호출자가 이력을 쥔다"에 기댄다 — 서버가 대화를 소유하면 깨진다, F4).
- **검증:** 309 pass / 4 skip / 0 fail (core 81 · tools 28 · mcp 37 · model 97 · **agent 20** · studio 46 — **agent 뺀 다섯 무수정**). ([노트 26](notes/26-f3_3-approval.md))
- **벽 → 다음:** 게이트가 링에는 있는데 **누를 버튼이 없다.** `pendingToolCalls`를 응답에 실어 승인/거부 버튼을 붙이면 S11이 폴더 하나로 좁혔던 회피를 거두고 `filesystem` 에이전트에게 쓰기 툴을 열 수 있다 → **S12**. 그다음이 F3의 마지막인 **세션**.

### F4 · 메모리 링 — `@ariadne/memory`

> **F4를 넷으로 쪼갠다.** 원래 한 줄("대화 히스토리 + RAG + 영속성")이 성격이 다른 넷을 뭉쳐놨다.
> 그중 **체크포인터만 엔진 작업**이고 나머지 셋은 링에서 끝난다 — 그리고 체크포인터는
> **모델이 안 읽는 유일한 것**이라 성격이 아예 다르다(langgraph도 `checkpoint/`와 `store/`를
> 다른 것으로 갈라놨다). 그래서 **가장 안 바뀌는 것부터**, 체크포인터를 맨 뒤로 미룬다.
>
> 목표 장면 하나로 잡는다: **위험한 툴을 두 번 거부하면, 세 번째 턴엔 모델이 툴을 바로 안 부르고 먼저 묻는다.**

#### F4.0 · 실험 — 주입이 행동을 바꾸나 — [x] 완료
설계를 밀기 전에 **가장 위험한 가정**을 먼저 깼다. system에 문장 하나를 넣고 "모델이 툴을 즉시 부르는가"를 측정(claude-code/sonnet, 조건당 N=6).
- **주입은 작동한다** — 기준선 6/6 즉시 호출 vs 명령형 0/6.
- **계획이 반증됐다.** "절차=명령형이 행동을 바꾸고 의미=서술형은 판단 재료"라고 봤는데, **선호 서술(0/6)과 명령형(0/6)이 같았다.** 형식은 무관했다.
- **가르는 건 추상화 수준이다** — 사건을 그대로 옮긴 문장("거부한 적이 있다")은 **효과 0(6/6)**, 거기서 선호·규칙을 뽑아낸 문장만 행동을 바꾼다. → `facts`에 `kind`(의미/절차) 컬럼을 **두지 않는다**, 생성기는 **추상화 수준이 다른 후보 여럿**을 만든다.
- **덤:** 측정 도구가 고장 나 있었다 — 프롬프트 툴 심의 폴백 탐욕 정규식이 JSON 뒤 중괄호 낀 산문에 걸려 **툴 호출을 통째로 잃고** 있었다(`write_file`류에서 재현). 별도 커밋 `4b1cfba`로 수정. 안 고쳤으면 이후 모든 측정이 무효였다.

#### F4.1 · 기록 — 겪은 일과 가치 신호 — [x] 완료
- **도는 것:** `bun run --filter '@ariadne/memory' example` (자격증명 0 · 네트워크 0 · 파일 0). 스튜디오에선 승인/거부가 SQLite에 쌓이고 `GET /api/memory?agent=`로 관찰된다. **동작은 한 글자도 안 바뀐다 — 기존 스튜디오 테스트 52개가 무수정 통과하는 게 그 증거다.**
- **테이블 둘을 나눈 게 전부다.** `episodes`(겪은 일) / `value_events`(내린 결정). 표준 설계는 세션 끝에 LLM에게 "중요한 걸 요약해"라고 시키는데, 그건 무엇이 중요한지를 **쓰는 시점에** 판단하는 것이다 — **중요성은 저장의 속성이 아니라 사용의 결과다.** 그래서 가치 채널엔 해석을 하나도 안 넣는다(거부됐다는 사실만, 왜인지는 안 적는다).
- **가치 신호는 이미 있었다** — F3.3의 승인 버튼. 사람이 `거부`를 누르는 순간이 라벨이고, 이게 **F3.3과 F4를 잇는 뜻밖의 다리**다.
- **에피소드 = 한 run. 멈춤과 재개를 안 잇는다.** 계획은 접두사 휴리스틱으로 이으려 했는데 접었다 — ① 집계가 `(agent,target,kind)`라 상관관계를 안 쓴다 ② 휴리스틱은 **조용히 틀리고 그 오염이 DB에서 정상 행과 구분이 안 된다** ③ **노트 26이 이미 "재개는 새 run"이라고 못박았다.**
- **판단 셋:** `kind`에 `"ask"`가 없다(사람의 결정이 아니라 시스템 상태, `pending`으로 이미 관찰됨) · `target`은 **게이트를 촉발한 이름만**(묶음 승격이 집계를 오염시키지 않게, 플래그 컬럼 대신 **기록 시점 필터**로) · `MemoryStore`가 **두 번째 클래스**(`McpClient`와 같은 이유 — 감출 핸들과 닫아야 하는 수명).
- **이 링도 런타임 의존성 0** — `bun:sqlite`는 Bun 내장, core는 `import type`으로만. **core 다음으로 deps 0인 두 번째 패키지**(F1 이후 바깥 링은 늘 SDK를 달고 왔다).
- **memory를 아는 자리가 하나로 갇힌다** — `TurnHooks` 하나로 좁혀 `approvalPolicy`는 저장소를 모르고, `agentTurn`만 안다(`connectMcpAgents`가 mcp를 아는 유일한 자리였던 S11과 같은 모양). `try/finally`로 반드시 닫는다 — 안 그러면 실패한 run이 `running`으로 남아 관찰이 거짓말이 된다.
- **검증:** 344 pass / 4 skip / 0 fail (core 81 · **memory 16** · tools 28 · mcp 37 · model 105 · agent 20 · studio 52→**57**). memory·studio 밖 **다섯 패키지 무수정**. ([노트 28](notes/28-f4_1-memory-record.md))
- **벽 → 다음:** 재료는 쌓였는데 **아무도 안 읽는다.**

#### F4.2 · 공고화와 주입 — 쌓인 것이 문장이 되어 모델에게 간다 — [x] 완료
- **도는 것 = 목표 장면.** 스튜디오 `mcp` 에이전트에 메모 저장을 2회 요청하고 2회 거부하면, **세 번째 턴엔 모델이 툴을 바로 안 부르고 먼저 묻는다**(실측: `steps: [['model']]` — 툴 노드에 아예 안 갔다). F4.1까지는 같은 요청이 곧바로 `write_note`를 불러 멈췄다. **기억이 행동을 바꿨다.** 오프라인 데모는 `example:loop`(자격증명 0·네트워크 0·파일 0).
- **`createAgent`도 core도 안 고쳤다** — 계획은 `recall` 노드 + `memories` 채널을 두려 했는데 **셋 다 안 했다.** 이미 열려 있는 길이 있었다: `composeSystem` → `AgentConfig.system` → `model.invoke({system})` → 어댑터가 프로바이더 system 자리로. 즉 **메모리 주입은 새 노드도 새 채널도 새 실행 개념도 아니라 문자열 합치기다.** 그리고 이게 **F4.0 실험이 측정한 바로 그 경로**라, 노드로 만들었으면 실험과 구현 사이에 검증 안 된 층이 하나 꼈다. 테스트가 못박는다 — "사실을 줘도 `getGraph()` 결과가 동일".
- **안 고른 길:** `messages`에 system 메시지 끼우기 — 어댑터가 올려주긴 하지만 `agentTurn`이 새 메시지를 **위치로**(`slice(history.length)`) 자르므로 어긋나고 이력에 눌어붙는다. 무상태 규약(F3.3)이 주입 경로를 하나로 좁혀줬다.
- **후보를 셋 만들고 하나만 쓴다** — `episodic`(효과 0 예측) · `preference` · `rule`. **`kind`(의미/절차) 컬럼은 없다**(F4.0이 형식은 무관하다고 실측). `level`은 **순위에 안 쓰인다** — 있는 이유는 **"사건형이 도태되는 것"을 관찰하기 위해서**다.
- **임계 둘:** 거부 2회 이상(1회는 사고일 수 있다) **AND** 거부 > 허용 — **대개 허용하는 툴이면 선호가 아니다.** 한 번 거부했다고 그 뒤 열 번 승인한 툴을 막으면 기억이 사람을 돕는 게 아니라 방해한다.
- **멱등을 플래그가 아니라 `UNIQUE(agent,text)` + `INSERT OR IGNORE`로.** "어디까지 공고화했나"를 아무도 안 들고 있어도 되고, **이미 도태된 사실이 부활하지 않는다**(재공고화가 기존 행을 안 건드림 → F4.3의 선택 기록이 산다). `CREATE TABLE IF NOT EXISTS`뿐이라 기존 DB에 `facts`가 그냥 붙는다 — **마이그레이션 개념이 아직 없다.**
- **공고화는 턴 시작에.** "유휴 시 배치"는 타이머라는 새 수명주기를 부르는데 지금 답하는 질문이 없다. 부작용: `GET /api/memory`가 한 턴 늦게 사실을 보여준다(실측에서 겪음).
- **발견 · 사건형만 계속 늘어난다** — 횟수가 문장에 박혀 있어 거부가 3회가 되면 새 행이 된다(선호형·규칙형은 문장이 안정적이라 한 번뿐). "사건은 일반화가 안 된다"가 스키마 층에서 다시 드러났다. 도태 기계가 이 잉여를 저절로 정리하는지가 F4.3의 좋은 시험이 된다.
- **검증:** 364 pass / 4 skip / 0 fail (core 81 · **memory 29** · tools 28 · mcp 37 · model 105 · agent 20 · studio **64**). memory·studio 밖 **다섯 패키지 무수정**. ([노트 29](notes/29-f4_2-consolidate.md))
- **벽 → 다음:** 후보 셋을 만들어 놓고 **`preference`를 손으로 골랐다.** 무슨 근거로? 실험 결과를 **코드에 하드코딩**했을 뿐이고 **기계는 아직 아무것도 안 배웠다.**

#### F4.3 · 선택 기계 — 그리고 그 기계가 내놓은 뜻밖의 답 — [x] 완료
- **도는 것:** `bun run --filter '@ariadne/memory' example:loop` — 거부 2회 → 후보 셋 → 12턴 라운드로빈 → 성적표. F4.2의 하드코딩(`level === "preference"`)이 걷혔다. **LLM 호출 0.**
- **네 가지:** ① **한 턴에 하나만** 시험(동시에 넣으면 귀속이 안 된다 — 그 순간 선택 기계가 아니라 프롬프트 덧붙이기다) ② 판정은 **행동**을 본다(대상 툴을 그냥 불렀나) ③ **어휘 중첩 안 씀** — `"쓸까요?"`(성공)와 `"했습니다"`(실패)가 똑같이 겹친다, **성공과 실패에 같은 점수를 주는 지표는 지표가 아니다** ④ 점수를 캐시 안 함(`injections`를 매번 집계) — 숫자만 남기면 **"왜 이겼나"의 근거가 사라진다**.
- **`neutral`이 따로 있다** — 툴을 불렀는데 승인 게이트가 멈춰 세웠으면 **게이트의 공이지 기억의 공이 아니다.** 안 가르면 게이트가 잘 막아준 걸 기억의 성적으로 착각한다.
- **⚠️ 검증 기준이 재현되지 않았다.** 이 커밋의 시금석은 "사건형 후보가 스스로 도태되는가"였는데, 스튜디오 실측에서 **셋이 동률(+2)로 나왔다.** 감도 문제는 아니다 — **기준선 6/6 즉시 호출 vs 주입 0/6**으로 여유가 충분했고, **정말로 셋 다 먹혔다.**
- **F4.0과 정반대다.** 거기선 사건 서술이 6/6(효과 0)이었는데 여기선 0/6이다. 차이 셋 중 **가장 의심스러운 건 `[기억한 것]` 틀** — F4.2의 `composeSystem`이 만든 이 틀을 F4.0은 안 썼다. **실험과 구현 사이에 끼워 넣은 교란 변수**이고, 다음 실험 대상이다.
- **그래서 성공도 실패도 아니다.** 기계는 돌았고(라운드로빈이 셋에 정확히 2회씩, 판정이 행으로 남음), **하드코딩을 걷어낸 건 옳았다**(`preference`만 남겼으면 똑같이 잘 듣는 후보 둘을 근거 없이 버렸다). 다만 예측은 틀렸다. 노트 26에 이어 **두 번째 빗나간 사전 예측**이고, 둘 다 **먼저 재봤기 때문에** 알았다.
- **검증:** 385 pass / 4 skip / 0 fail (core 81 · **memory 46** · tools 28 · mcp 37 · model 105 · agent 20 · studio **68**). memory·studio 밖 **다섯 패키지 무수정**. ([노트 30](notes/30-f4_3-selection.md))
- **벽 → 다음:** **판정이 이분법이라 셋을 못 가른다.** 신호가 "대상 툴을 불렀나" 하나뿐이라 셋 다 안 부르게 만들면 **셋 다 만점**이고 순위가 안 생긴다. 더 미세한 신호가 필요하다 — 사람이 결국 **승인했나** · 몇 턴 만에 끝났나 · 토큰. 그리고 `[기억한 것]` 틀만 남기고 문장을 빼면 어떻게 되는지도 재봐야 한다.

> **F4.4(체크포인터)는 F5로 승격됐다.** "실행 상태 영속"은 F4가 다루는 *장기 기억*과 성격이 아예 다르다 —
> **모델이 안 읽는 유일한 것**이고, 링이 아니라 엔진에 손을 대야 한다. 그리고 그 필요를 부르는 벽(세션)도
> 메모리가 아니라 실행 쪽에서 온다. 그래서 자기 단계(F5)를 받았다.

## 다음: Ops·Thread 트랙 (F5 → F9)

> 사용자가 지목한 다섯(체크포인터·HITL 검증 / 트레이싱 / 메트릭·evals·QA / 워크플로우·서브에이전트 / **아리아드네의 실**)은
> 서로 독립이 아니라 **하나의 의존 사슬**이다. 실의 정의가 "**evals 기준 베이스라인과 동일 성능**"이므로
> 앞의 넷은 곁가지가 아니라 **실의 부품**이고, 그래서 실이 맨 끝에 온다. (정체성 서술은 [VISION.md](VISION.md).)

### F5 · 멈춤과 재개 — 이력이 쥐고 있던 것을 엔진이 받아 든다

> F3.3은 체크포인터 없이 HITL을 만들었다. **그게 가능했던 건 이 에이전트의 상태가 `messages` 하나뿐이었기 때문**이고,
> 그 전제를 먼저 **깨보는 것**으로 이 트랙을 연다. (구 F4.4가 여기로 승격·흡수됐다.)

**langgraph 원본 대조 — 무엇을 버리고 무엇을 남기나.**
우리의 멈춤은 **항상 정지점**이다: `loop.ts`의 루프는 `prepareNextTasks`가 빈 배열일 때만 빠져나오고, 그 순간 트리거 채널(`EphemeralValue`)과 `TASKS`(`Topic`)는 전부 비어 있으며, `approval.ts`의 `"ask"`는 **아무것도 안 쓰고** 끝난다. 이 조건에서 원본의 대부분이 불필요해진다.

| langgraph가 저장하는 것 | 우리는 | 그걸 요구하는 기능 |
|---|---|---|
| `channel_values` | **필요** | 상태 그 자체 |
| `channel_versions` · `versions_seen` | **아마 불필요 — F5.2에서 실측** | `_algo.py`의 `_triggers`가 "available **AND** 버전 전진"을 본다. 우리는 트리거가 `EphemeralValue`라 **available = 이번에 쓰였다**가 동치다 |
| `pending_writes` · `writes` 테이블 · `WRITES_IDX_MAP` | **전부 불필요** | `interrupt()` · 부분 실패 재개 · `Command(resume=)` |
| `pending_sends` | 불필요 (v4에서 `TASKS` 채널로 흡수, `pregel/main.py:1136`) | — |
| `checkpoint_ns` · `parents` | 지금은 불필요, **컬럼만 미리 둔다** | 서브그래프(F8에서 온다) |
| `parent_checkpoint_id` | 남긴다 (비용 0, 디버깅 가치) | time travel / fork |
| msgpack·pickle serde | 불필요 — **JSON** | Python 임의 객체 |

> `pregel/_checkpoint.py`는 331줄인데 **본질은 `empty_checkpoint`/`create_checkpoint`/`channels_from_checkpoint` 약 60줄**이고, 나머지는 전부 interrupt·서브그래프·time travel·성능이 요구한 부가물이다. **개념 중심 재구성이란 그 60줄만 가져오는 것이다.**

#### F5.1 · HITL을 반증한다 — 구현 0, 테스트만 — [x] 완료
- **도는 것:** `bun test packages/agent/test/resume.test.ts` — **자격증명 0 · 네트워크 0 · `src/` 무수정.**
  - ① **프로세스를 죽였다 살린다** — `test/fixtures/turn.ts`가 턴 하나만 돌고 죽는다. 두 자식 사이에 오가는 건 **JSON 문자열 하나뿐**이다. 통과했다 → 주석이 괄호로만 주장하던 "(=프로세스가 죽었다 살아나도)"가 근거를 얻었다. 한 프로세스 테스트가 못 하던 것도 한다 — **각 자식이 자기 `ran` 배열만 증언한다**(첫 자식 `[]`, 둘째 `["a.txt"]`). 모듈 변수가 재개를 돕고 있었을 가능성이 메모리째 사라졌다. `"deny"` 재개도 `tools`부터 들어간다(③을 흡수 — 정확성 문제다).
  - ② **반례(핵심). 예측이 틀렸다 — 두 배가 아니라 증발이다.** `schema`에 `plan`·`budget`을 더한 `createAgent`로 같은 왕복. 실측: 턴 1 상태 키 `[messages, plan, budget]` → 턴 2 **`[messages]`**. `undefined`가 아니라 **키 자체가 없다**(`readChannels`가 값 없는 채널을 안 담는다). **두 배가 안 되는 이유는 `binop.ts`의 `acc === MISSING ? v : operator(acc, v)`** — 빈 채널엔 seed일 뿐이고, `stream()`마다 채널이 새로 만들어져 재개 run은 늘 비어 있다.
  - **그리고 이쪽이 더 나쁘다** — 게이트는 **완벽히 작동한다**(`tools → model`, 툴 1회, 대기 0). 아무도 뭔가 사라졌다고 안 알려준다. **소리 없는 실패가 시끄러운 실패보다 나쁘다**(F4.1이 접두사 휴리스틱을 접은 것과 같은 이유).
  - **`messages`가 무사한 건 id 덕분이 아니다** — 이력에 `id`가 하나도 없는데도 중복이 안 생긴다. 채널이 새로 만들어져 **그대로 놓였을** 뿐이다. 진짜 규약은 **"클라이언트가 모든 채널을 손으로 이월한다"**이고, `messages`는 늘 전부 다시 싣기 때문에 면제된 것처럼 보였을 뿐이다(세 키를 다 실으면 살아남는 것으로 확인).
- **왜 지금:** ROADMAP은 구 F4.4를 "세션이 생기면 필요해진다"고 **예고만** 해왔다. 예고는 벽이 아니다. **이 커밋이 그 벽을 실제로 만든다.**
- **안 하는 것(정직):** 아무것도 안 고쳤다(`src/` 무수정 · export 0 증가 — 반례를 `createAgent`로 세운 덕에 `gatedToolNode`류를 공개 안 해도 됐다) · **오늘 이 문제로 깨지는 그래프는 저장소에 없다**(`AgentConfig.schema`를 넘기는 호출부가 0개다 — 잠재적 벽이지 현재 버그가 아니다) · 게이트는 추가 채널을 모른다.
- **덤:** **재귀 한도 100이 왕복마다 리셋된다**(`const limit = 100`이 `stream()` 안에 있다). 스텝 수로 폭주를 막으려는 시도는 지금 구조에선 실패한다.
- **검증:** 357 pass / 3 skip / 0 fail (core 81 · memory 46 · tools 28 · mcp 37 · model 105 · **agent 20 → 26** · studio 34). **agent 밖 여섯 패키지 무수정.** ([노트 32](notes/32-f5_1-resume-honesty.md))
- **벽 → 다음:** 재개가 성립하는 범위는 **"클라이언트가 모든 채널을 들고 있는 그래프"**다. 상태를 어딘가 둬야 하는데, **되돌려 넣기로는 못 고친다 — 입력은 `applyWrites`로 들어가 리듀서를 타기 때문이다.** 복원은 *쓰기*가 아니라 *세팅*이고, 그건 채널 자신만 할 수 있다.

#### F5.2 · 채널이 자기를 내놓는다 — core의 유일한 영속 확장 ✅
- **무엇:** `channels/base.ts`에 `checkpoint(): unknown | typeof MISSING` / `fromCheckpoint(value)`. **새 인스턴스를 반환한다** — 프로토타입 오염 금지(원본 `last_value.py:53`, `binop.py:120`과 같은 모양). 채널 5종 구현. `loop.ts`의 `stream(input, opts?: { checkpoint })`이 채널 생성 시 **리듀서를 우회해** 복원하고, 그다음 입력을 평소대로 주입.
- **2단 분리가 전부다.** 저장 = `checkpoint()`(리듀서 적용이 **끝난** 스냅샷) · 복원 = `fromCheckpoint()`(직접 대입, 리듀서 **우회**) · 입력 = `applyWrites`(리듀서 **통과**). 섞으면 누적형 리듀서가 반드시 깨진다.
- **`MISSING`이 여기서 두 번째 일을 한다** — `checkpoint()`가 `MISSING`이면 **키를 아예 안 만든다**(원본 `_checkpoint.py:203`). 메모리 안에서는 빈 채널과 `undefined` 값을 구분하지만, JSON 저장은 `undefined` 키를 생략한다. 이 구분까지 보존하는 serde는 범위 밖이다.
- **복원 경계:** 상태 채널만 복원하고 START에서 다시 진입한다. 대기 중인 툴 호출은 에이전트 진입 라우터가 판별한다. 실행 위치를 이어가는 방식이 아니므로 버전 추적과 pending writes는 도입하지 않았다.
- **안 하는 것:** **제어 채널을 저장하지 않는다**(정지점에선 전부 비어 있다 — 저장하면 "언젠가 superstep 중간에서도 멈춘다"는 거짓말을 스키마에 새긴다) · pending writes · 저장소(core는 `bun:sqlite`도 파일도 모른다, **deps 0**) · JSON 외 serde · 스키마 버저닝.
- **두 배는 여기서부터의 위험이다.** F5.1이 실측했듯 지금은 재개 run의 채널이 비어 있어 입력이 seed될 뿐이라 두 배가 안 된다. 그런데 **복원을 넣는 순간** 값이 있는 채널 위에 입력이 접혀 `operator(3, 3) = 6`이 된다 — 그래서 복원이 `update()`면 안 되고, langgraph가 **복원은 대입 / 입력은 리듀서**로 두 경로를 가르는 이유가 이것이다. (F5.1의 테스트 3이 "값이 한 번 생기면 리듀서가 돈다"를 못 박아 뒀다.)
- **검증:** 채널 5종 왕복(`checkpoint() → JSON → fromCheckpoint()`). **F5.1 ②의 스냅샷이 뒤집힌다** — 턴 2 상태 키에 `plan`·`budget`이 **다시 나타난다**. `test/architecture.test.ts`와 기존 회귀 테스트 유지. 분석: `docs/notes/33-f5_2-channel-checkpoints.md`.
- **벽 → 다음:** 스냅샷을 만들 수 있게 됐는데 **둘 데가 없고**, "어느 대화의 스냅샷인가"를 가리킬 이름이 없다.

#### F5.3 · 체크포인터 — 모델이 읽지 않는 유일한 테이블 ✅
- **무엇:** `packages/memory/src/checkpoint.ts` + `schema.ts`에 `checkpoints(thread_id, checkpoint_ns DEFAULT '', checkpoint_id, parent_checkpoint_id, step, channels_json, created_at)`. PK `(thread_id, checkpoint_ns, checkpoint_id)`, **추가 인덱스 0개**(원본 sqlite와 같은 이유 — PK prefix가 최신 조회를 그대로 서빙한다). `MemoryStore.putCheckpoint/putCheckpoints/getLatest/list` + `@ariadne/agent`의 `runWithCheckpoint(graph, threadId, input, store)`.
- **`checkpoint_ns`는 지금 항상 `''`인데도 컬럼을 만든다** — F8 서브그래프가 올 때 마이그레이션을 없애려고. 비용이 0에 가까운 유일한 선행 선언이다.
- **왜 지금:** F5.2가 스냅샷을 만들었고, **F4.1이 남긴 구멍을 메운다** — "재개는 새 에피소드가 된다(둘을 잇는 키가 없고, 이을 이유도 아직 없다)"고 적어둔 그 키가 `thread_id`다.
- **저장 경계:** 스텝 스냅샷을 즉시 JSON 복사하되, 정상 종료 후 한 트랜잭션으로 저장한다. 최신 행만 정지점이며 중간 행은 관찰용이다. 실패한 run은 기존 정지점을 바꾸지 않는다.
- **안 하는 것:** 브랜치/타임트래블 API · 같은 thread의 동시 실행 제어 · GC/보존정책 · 다른 백엔드. 중간 행에는 실행 위치가 없으므로 그대로 재개할 수 없다.
- **검증:** F5.1 ①의 크래시 테스트를 **이력 없이** 다시 돈다 — 저장 직후 SIGKILL하고 새 프로세스에 DB 경로·`threadId`·승인 결정만 넘긴다. allow/deny, plan·budget 보존, 완료한 툴의 재실행 방지, 배치 롤백과 thread 격리를 검증한다. 분석: `docs/notes/34-f5_3-checkpointer.md`.
- **벽 → 다음:** 스레드는 생겼는데 **HTTP에 그 개념이 없다.** Studio HTTP에는 아직 영속 thread의 생성·조회·재개 계약이 없다.

#### F5.4 · 세션 — 서버가 대화를 소유한다 ✅
- **무엇:** `apps/studio/src/sessions.ts` + `POST /api/threads` · `POST /api/threads/:id/messages`(**body는 새 메시지 하나뿐**) · `GET /api/threads/:id`. 기존 `POST /api/agents/chat`은 **지운다**(호환 유지는 학습 코드에 부채다). `runTurn`이 `threadId`와 새 입력만 받는다. `threads(id, agent, created_at)`로 소유 에이전트를 영속화하고 F5.3 실행 래퍼를 사용한다.
- **`approval.ts` 상단 주석도 같이 갱신한다** — 무상태 규약이 F3.3 승인의 기반이었으므로 그 논지가 낡는다. 이 저장소는 **주석이 곧 노트**다.
- **왜 지금:** F5.2까지 브라우저가 체크포인트를 보관하고 다시 전달했다. 이제 브라우저는 thread ID만 보관하며, 서버가 DB에서 상태를 읽고 승인 대기를 검증한다.
- **안 하는 것:** 인증/멀티유저 · 스트리밍 응답(SSE는 트레이스와 같이 S14에서) · 이력 압축/요약 · 낙관적 동시성.
- **검증:** 승인 대기에서 새로고침해도 대화·예산·승인 버튼이 복구된다. HTTP 서버 강제 종료 후 같은 DB로 재개, allow/deny, 잘못된 입력 거절, thread 격리와 실패 시 상태 보존을 검증했다. 분석: `docs/notes/35-f5_4-server-threads.md`.
- **벽 → 다음:** 한 스레드가 여러 run을 갖고 각 run이 여러 superstep을 갖는데, **그 계층을 볼 눈이 없다.** `StepUpdate` 배열은 평평하고 시간도 없다.

### F6 · 관측 — 트레이스는 우리가 만들고, 이름표만 빌린다

#### F6.1 · 트레이스가 요구하는 것 셋 — core의 최소 확장 ✅
- **무엇:** ① `StepUpdate.tasks: TaskUpdate[]`(`{ id, name, startedAt, endedAt, writes, error? }`, `nodes`는 남긴다) + `committed`(태스크 실패 시 쓰기 미반영) ② `runTask`를 try/catch로 감싸 **실패 태스크도 yield에 실린 뒤** 던진다(에러는 계속 던진다 — 삼키면 거짓말이다) + `NodeExecutionError` ③ `AIMessage.usage?: { inputTokens, outputTokens }` + 어댑터 셋이 **버리던 usage를 채운다**.
- **셋 다 이미 손에 있는 정보다.** `buffered` 쓰기는 `applyWrites` 직후 버려지고, usage는 어댑터가 파싱해놓고 버린다. 시각 기록·태스크별 결과 수집은 추가하지만 **core 런타임 deps 0**을 유지한다.
- **오늘 없는 것 셋:** 시간이 없다 · **노드 귀속이 없다**(한 스텝에 두 노드가 돌면 `state`는 이미 합쳐진 결과라 누가 뭘 썼는지 모른다) · **실패가 안 남는다**(노드가 던지면 그 스텝의 yield 자체가 사라진다 — **가장 값진 트레이스인 실패 트레이스가 통째로 없다**).
- **`usage`가 core인 근거:** F2.2의 규칙 그대로 — **"채널에 사는 것만 core에 둔다."** usage는 AI 메시지에 실려 다닌다. 단가표는 링이고, 레지스트리에 단가가 없으므로 **비용($)은 안 만든다 — 토큰까지가 정직한 선이다.**
- **안 하는 것:** core에 콜백/훅 인터페이스(`onNodeStart` 등)를 **넣지 않는다 — yield가 이미 훅이다.** 스팬·traceId·샘플링·전송은 전부 링.
- **검증:** 던지는 노드가 있는 그래프에서 `stream`이 **그 스텝을 yield한 뒤** 던진다. 한 스텝 두 노드 병렬에서 `tasks[i].writes`로 누가 무엇을 썼는지 갈린다. 가짜 어댑터로 usage 전달·캐시 합산·미보고/0 구분. 분석·후속 설계: [36-f6_1-observability.md](notes/36-f6_1-observability.md).
- **벽 → 다음:** 스텝 배열은 있는데 **계층이 없다.** run > superstep > node > 모델호출 > 툴호출의 중첩을 core는 볼 수 없다 — 모델·툴 호출은 `bound` 안에서 일어난다.

#### F6.2 · `@ariadne/observability` — 스팬 트리를 우리가 만든다 ✅
- **새 패키지. 런타임 deps 0** (core·memory 다음 **세 번째**). `observability → core`(타입만). **`model`·`tools`를 모른다** — 계측은 감싸기로 하고, **감싸는 쪽이** 그 둘을 안다.
- **무엇:** `span.ts`(`Span { traceId, spanId, parentId, name, startedAt, endedAt, attributes, status }` + hex id 생성) · `graph.ts`(`StepUpdate.tasks` → superstep/node 스팬) · `model.ts`(`traced(model)` → `chat {model}` 스팬) · `tools.ts`(`execute_tool {name}`) · `collector.ts`.
- **어휘만 빌린다 — 구현은 우리가 한다.** OpenTelemetry GenAI semantic conventions에서 `gen_ai.operation.name` · `gen_ai.provider.name` · `gen_ai.request.model` · `gen_ai.usage.*` · `gen_ai.tool.name`만 가져온다. **우리 것은 `ariadne.*`** — `ariadne.superstep` · `ariadne.node` · `ariadne.channel.writes`.
- **superstep은 사용자 정의 계층으로 보존한다.** `ariadne.*` span도 부모관계를 실으면 외부 trace tree에서 표현할 수 있다. 자체 UI의 가치는 계층 유무보다 그래프·채널 쓰기와 연결한 설명이다.
- **부모 연결:** core는 기존 task ID·이름·스텝·시작 시각만 읽기 전용 `TaskContext`로 노드에 전달한다. run별 `trace.node` 래퍼가 실행 전에 부모를 만들고 `StepUpdate`로 닫는다. 콜백·trace ID·스팬은 core에 없다. `createAgent({ trace })`는 모델·툴까지 연결한다.
- **이 단계의 발견:** 계측 지점이 정확히 둘로 갈린다 — **엔진은 yield로 관찰되고, 링은 감싸기로 관찰된다.**
- **안 하는 것:** OTel SDK 의존 · OTLP 전송 · Langfuse 연동(**참고 자료로만 쓴다**) · `AsyncLocalStorage`(부모 스팬은 **명시 인자**로 넘긴다 — 감춘 전역은 학습을 막는다) · 샘플링·배치.
- **검증:** ReAct 3라운드 run에서 스팬 트리의 깊이·부모관계·개수가 정확. 실패 run에서 스팬이 `status: "error"`로 **닫힌다**(열린 채 안 남는다). 같은 이름 Send·동시 run·승인 재개·관측 유무의 결과 일치를 검증했다. 분석: [37-f6_2-span-tree.md](notes/37-f6_2-span-tree.md).
- **벽 → 다음:** 트레이스가 쌓이는데 **아무도 점수를 안 매긴다.** "잘 도는가"에 답할 수 없다.

### F7 · `@ariadne/evals` — "잘 도는가"를 숫자로 정한다

> 분류는 [deepeval](https://github.com/confident-ai/deepeval)의 3층(reasoning · action · execution)을 빌리되,
> **가르는 기준은 "판정에 모델이 필요한가"**로 다시 잡는다. 결정론적인 것부터 만든다 —
> 싸고, 재현되고, **판정자 자체를 검증할 기준**이 되기 때문이다.

#### F7.1 · 데이터셋과 러너 — 케이스, k회, 성적표
- **새 패키지. deps 0.** `evals → core`(타입) + `evals → observability`. **`agent`·`model`을 모른다** — 평가 대상은 `(input) => Promise<RunRecord>` 함수로 주입받는다(F1의 `CreateMessage` 주입점과 같은 수법: 테스트가 캐스팅 없이 가짜를 꽂는다).
- **무엇:** `dataset.ts`(`EvalCase { id, input, expected?, check?, rubric?, tags? }`) · `runner.ts`(케이스 × k회, 동시성 제한, `RunRecord { steps, messages, spans, error? }`) · `report.ts` · `datasets/`(**결정론적 가짜 툴** 기반 12~20건).
- **오프라인이 기본이다.** F1의 규약대로 **키 없이 `bun run verify`가 그린**이어야 하므로 러너·메트릭은 가짜 툴 + 스크립트된 모델로 전부 테스트된다. 실모델 실행은 `bun run evals`라는 **별도 스크립트**로 분리.
- **검증:** 가짜 실행기로 k=3이 케이스×3 레코드를 정확히 모은다. 실행이 던져도 **레코드가 남는다**(`error` 필드) — 실패한 run이 데이터에서 사라지면 성적표가 거짓말을 한다.
- **벽 → 다음:** 레코드는 쌓이는데 **점수가 없다.**

#### F7.2 · 결정론적 메트릭 — 궤적·툴·효율 (LLM 0)
| 메트릭 | 참고 | 우리 자료구조로 |
|---|---|---|
| task success rate | 모든 에이전트 벤치마크의 1차 지표 | 케이스가 준 `check(final) => boolean`. 기본 체커 3종(`exact`·`contains`·`stateEquals`) |
| **tool correctness** | deepeval `ToolCorrectnessMetric` | 기대 호출 vs `AIMessage.toolCalls` — **이름만** |
| **argument correctness** | deepeval `ArgumentCorrectnessMetric` | 인자 부분집합 / 완전일치 2단 |
| trajectory exact · in-order · any-order | LangSmith·ADK | **두 층에서 뽑는다**: 그래프층 `steps.flatMap(s => s.nodes)` · 툴층 toolCall 이름 시퀀스 |
| trajectory precision · recall | 〃 | **불필요한 툴 호출을 잡는 유일한 지표** → 실의 평가에서 핵심이 된다 |
| **step efficiency** | deepeval `StepEfficiencyMetric` | `steps.length` + `agent.ts`의 `toolRoundsSinceLastHuman`을 **그대로 재사용**(이미 있다) |
| latency · tokens | 비용 | F6.1의 `startedAt/endedAt` · `AIMessage.usage` 합 |
| tool error rate · recursion-limit hit | 실패 모드 | `ToolMessage.status === "error"` · 재귀 한도(100) 발생률 |
| **pause rate (HITL)** | 이 저장소 고유 | `pendingToolCalls(final).length > 0`인 run 비율 — "얼마나 자주 사람을 부르나" |
| **pass@k · pass^k** | τ-bench | k회 실행. 기본 리포트는 **`pass^k`**(k번 전부 성공) — 에이전트에서 의미 있는 건 최고치가 아니라 **최저 보장**이다 |

- **각 메트릭은 `(record) => { value, detail }`인 순수 함수다.** `detail`이 있는 이유는 F4.3의 교훈 — **숫자만 남기면 "왜 이겼나"의 근거가 사라진다.**
- **안 하는 것:** 비용($) — 레지스트리에 단가가 없다. 단가표는 "모델별 메타데이터가 필요해질 때" 생성기를 넓힌다. 통계적 유의성은 F7.4.
- **검증:** 손으로 만든 궤적 픽스처로 경계값(빈 궤적 · 중복 호출 · 순서 뒤바뀜 · 여분 호출)을 전부 못 박는다. `toolRoundsSinceLastHuman` 재사용이 agent 링과 **결과가 같은지** 대조.
- **벽 → 다음:** 자유형 답변 케이스에서 체커가 **못 자른다.** "맞는 말을 다르게 썼다"를 통과시킬 방법이 없다.

#### F7.3 · 판정자 — 그리고 판정자를 판정한다
- **무엇:** `judge.ts`(`ChatModel`을 **구조적 타이핑으로** 받는다 — `@ariadne/model`을 import하지 않는다, F2.2의 링 규칙). deepeval의 두 모양을 나눠 가져온다 — **G-Eval식**(자유 서술 기준 + 점수)과 **DAG식**(결정 트리: 형식 검사 먼저, 그다음 내용).
- `groundedness.ts` — 컨텍스트는 **그 run의 `ToolMessage`들**이다. 밖에서 안 가져온다: **툴 결과가 곧 컨텍스트**라 RAG 없이 성립한다. 툴 메시지가 0개인 run은 `N/A`(**억지 점수 금지**).
- `taskCompletion.ts`(rubric) — deepeval `TaskCompletionMetric` 대응.
- **`judgeAudit.ts` — 이 단계의 본체다.** 같은 입력에 판정자를 n회 돌려 **자기 일치도**를 재고, F7.2의 결정론적 라벨과 **일치율**을 낸다. 임계 이하인 메트릭은 리포트에 **경고 딱지**를 달고 나간다. (F4.0~F4.3의 "먼저 재본다" 문화 그대로 — **숫자를 조용히 믿지 않는다.**)
- **안 하는 것:** 판정자 앙상블·파인튜닝 · 사람 라벨 수집 · pairwise 비교.
- **벽 → 다음:** 메트릭은 다 있는데 **기준선이 없다.** "좋아졌다"를 말할 상대가 없다.

#### F7.4 · 베이스라인 — 범용 에이전트의 성적표를 고정한다
- **무엇:** `datasets/general-v1` × 기본 에이전트(`createAgent` + 툴 다섯)로 k회 실행한 **성적표를 파일로 커밋**(`evals/baselines/general-v1.json`). `compare.ts` — 두 성적표의 차이 + **이항 신뢰구간**으로 "이 차이는 노이즈인가"를 판정한다(케이스 20개에서 1개 차이는 노이즈다 — 그걸 **먼저 계산해서 못 박는다**).
- **왜 지금:** **아리아드네의 실은 이 파일 없이는 시작조차 못 한다.** 실의 정의가 "베이스라인과 동일 성능"이기 때문이다.
- **안 하는 것:** 여러 모델 비교 매트릭스 · 리더보드 · CI 자동 게이트.
- **검증:** 같은 에이전트를 두 번 재서 **비교기가 "차이 없음"이라 말하는지** — 비교기 자체의 위양성 확인이 이 단계의 진짜 테스트다.
- **벽 → 다음:** 베이스라인의 궤적을 들여다보면 **같은 툴 순서가 계속 반복된다.** 매번 모델에게 물어보면서.

### F8 · 워크플로우와 서브에이전트 — 노드 안에 그래프가 있다

#### F8.1 · 서브그래프 = 노드 — 엔진은 끝내 모른다
- **무엇:** `packages/agent/src/subgraph.ts`의 `asNode(sub, { input, output })` — 부모 상태 → 자식 입력, 자식 최종 상태 → 부모 부분 상태 매핑. **관찰이 본체다**: `GraphView`에 중첩 뷰(**그림만, 실행 무관** — S6의 `targets` 원칙 그대로), `observability`가 자식 `stream()`을 부모 스팬 아래로 중첩.
- **핵심 발견(예상): 실행은 core 수정 0으로 이미 된다.** `CompiledGraph.invoke()`는 `async (S) => S`라 `addNode("sub", s => sub.invoke(s))`가 오늘 돌아간다 — `bound`가 `unknown → unknown`이라 **엔진은 그 안이 그래프인지 모르고, 그게 정답이라는 증거다**(불변식 3의 한 층 위). 바뀌는 건 전부 **관찰**이다.
- **별도 런타임은 안 쓴다.** 그건 두 번째 상태 저장소를 만들고, 그 순간 **불변식 1("채널이 유일한 공유 가변 상태")이 거짓이 된다.** F3.1의 "에이전트에 새 실행 개념은 없다"의 한 칸 위 버전 — **서브에이전트에도 새 실행 개념은 없다. 노드일 뿐이다.**
- **안 하는 것:** core에 `addGraph()` sugar — **세 번 손으로 쓴 다음에** 접는다(F3.1의 기준) · 자식 채널의 부모 자동 매핑 · 자식 멈춤의 부모 전파.
- **검증:** 3층 중첩 그래프의 최종 상태 · 스팬 트리 · 중첩 `getGraph()`. 자식이 던지면 부모 스팬이 error로 닫히고 `NodeExecutionError`가 노드 이름을 이어붙인다.

#### F8.2 · 슈퍼바이저 — 서브에이전트를 툴처럼 부른다
- **무엇:** `asTool(agent, { name, description, schema })`로 서브에이전트를 `AnyTool`로 감싼다 + `createSupervisor({ model, agents })`. **두 모양을 나란히 둔다** — 정적(F8.1: 그림에 보이고 결정론적) vs 동적(여기: 모델이 고르고 유연).
- **왜 지금:** F8.1이 매핑을 정의했다. 툴로 감싸는 건 그 매핑을 JSON Schema로 선언하는 것뿐이다.
- **안 하는 것:** 에이전트 간 직접 메시지 전달 · 동적 에이전트 생성 · 병렬 서브에이전트 팬아웃(**`Send`가 이미 있다** — 필요하면 그걸 쓴다).
- **검증:** 같은 태스크를 (a) ReAct 단일 (b) 슈퍼바이저+서브 둘로 풀고 **F7 성적표를 비교한다.** "구조를 바꾸면 성능이 어떻게 변하나"를 **처음으로 숫자로 본다** — 다음 단계의 예고편이다.

#### F8.3 · 워크플로우 — 모델이 안 고르는 그래프
- **무엇:** 실이 **출력할 목표 형태**를 사람이 먼저 손으로 써본다 — 고정 파이프라인 · 순수 함수 라우터 분기 · `Send` 팬아웃+join. 각 노드는 LLM 한 번 또는 툴 한 번.
- **왜 지금: 실의 출력 형식을 모르면 실을 만들 수 없다.** 손으로 한 번 써봐야 `GraphSpec`에 무엇이 들어가야 하는지 안다. (F4.2의 `composeSystem`을 손으로 쓰고 F4.3에서 기계화한 순서 그대로.)
- **안 하는 것:** DSL/YAML · 재시도·타임아웃·보상 트랜잭션 같은 워크플로우 엔진 기능(**그래프로 표현 가능한 것만**).
- **검증:** 베이스라인 데이터셋의 **가장 정형적인 태그 하나**를 손으로 쓴 워크플로우가 ReAct와 **같은 성공률에 더 적은 step·토큰**으로 푼다. **이 숫자 하나가 아리아드네의 실이 존재할 이유의 실측 증거다.**
- **벽 → 다음:** 손으로 쓰니 된다. **그런데 그때 내가 한 일은 "성공한 궤적을 들여다보고 반복되는 순서를 굳힌 것"뿐이었다. 그건 기계가 할 수 있다.**

### F9 · 아리아드네의 실 — 궤적에서 구조를 응고시킨다

> **이 저장소의 정체성**([VISION.md](VISION.md)). 범용 에이전트의 성능을 측정하고(F7),
> 그 궤적에서 그래프를 뽑아내(F9), 같은 성능을 내는지 **같은 자로 재서** 증명한다(F7).
>
> - **입력**: 범용 에이전트 + 툴 집합 · 태스크 데이터셋 · 그 위에 남은 **트레이스 코퍼스**와 **베이스라인 성적표**.
> - **출력**: `GraphSpec`(JSON) → 인터프리터 → **읽을 수 있는 `StateGraph` TypeScript 소스**.
> - **"동일 성능"의 판정**: 같은 데이터셋·같은 k에서 `성공률 ≥ 베이스라인 − ε` **그리고** `평균 step ≤` **그리고** `토큰 ≤`.
>   즉 목표는 "더 똑똑한 에이전트"가 아니라 **"같은 답을 더 싸고 더 예측 가능하게 내는 그래프"**다.

#### F9.1 · 응고 — LLM 없이, 궤적에서 그래프를 뽑는다
- **새 패키지 `@ariadne/thread`. deps 0.** `thread → core`(타입) + `evals` + `observability`. **`model`을 아직 모른다** — 이 단계엔 LLM이 한 번도 안 쓰인다.
- **무엇:** `corpus.ts`(성공 `RunRecord`에서 그래프층·툴층 시퀀스 추출) · `induce.ts`(접두사 트리 → **모든 성공 궤적이 공유하는 최장 공통 부분수열**을 뼈대로, 갈리는 자리만 라우터 노드로 남긴다 = **모델이 결정할 자리를 구조가 못 정한 자리로만 축소**) · `spec.ts`(`GraphSpec`) · `report.ts`(응고율 — 몇 갈래가 굳고 몇이 라우터로 남았나).
- **안 하는 것: LLM을 안 쓴다.** 프롬프트 합성이 들어오면 "그래프가 좋아진 건지 프롬프트가 좋아진 건지" 못 가른다. **실행도 안 한다**(스펙만 뽑는다).
- **검증:** 합성 코퍼스 왕복 — **내가 만든 정답 그래프로 궤적을 생성해, 귀납이 그 그래프를 복원하는가.** 그다음 실제 코퍼스에 돌려 응고율을 리포트.
- **정직한 예상:** 분기가 있는 태그에서 뼈대가 거의 안 남는다(공통 부분수열이 짧다). **그 실패의 모양이 F9.4가 풀 문제를 지목한다.**

#### F9.2 · 실행과 판정 — 뽑아낸 그래프가 같은 성능을 내는가
- **무엇:** `build.ts`(`GraphSpec` → `StateGraph` 조립 → `CompiledGraph`. **인터프리터지 코드 생성이 아니다**) · `verify.ts`(**같은 데이터셋·같은 k**로 돌려 F7.4 베이스라인과 `compare` → 합격/불합격 + 신뢰구간).
- **판정을 별도 커밋으로 가르는 이유: 그래야 "졌다"가 산출물이 될 수 있다.**
- **안 하는 것:** 코드 생성(F9.3) · 자동 수정(F9.4) · 프롬프트 최적화.
- **검증:** 합성 코퍼스에선 **합격해야 한다**(정답 그래프를 복원했으니). 실제 코퍼스에선 **성적표를 그대로 싣는다 — 지든 이기든.** 노트의 제목이 그 결과가 된다.
- **벽 → 다음:** 진 케이스를 보면 이유가 보인다(뼈대가 짧다 · 라우터가 틀렸다 · 노드 프롬프트가 없다). 그런데 **고칠 손이 없다.**

#### F9.3 · 코드로 — 실은 사라지고 그래프만 남는다
- **무엇:** `codegen.ts` — `GraphSpec` → **읽을 수 있는 `StateGraph` TypeScript 소스**.
- **왜 지금:** 학습 프레임워크로서 **최종 산출물은 사람이 읽고 고칠 수 있는 코드여야 한다.** 인터프리터만 있으면 블랙박스가 하나 더 생길 뿐이다. 그리고 생성된 코드가 **기존 예제와 구별 안 되게 읽힌다면** 그게 "그래프가 정말 뽑혔다"의 증거다.
- **안 하는 것:** 포매팅 라이브러리 의존(Biome가 이미 있다 — 생성물이 `bun run check`를 통과하면 충분) · 라운드트립(코드 → 스펙 역파싱).
- **검증:** 생성 코드를 파일로 쓰고 **실제로 import해 실행**해 인터프리터와 동일 결과. `tsc --noEmit` + Biome 통과.

#### F9.4 · 수리 루프 — 평가가 실을 당긴다
- **무엇:** `repair.ts` — 실패 케이스의 트레이스 + 현재 `GraphSpec`을 모델에게 주고 **스펙 수정안**(노드 추가 · 라우터 조건 변경 · 프롬프트 채우기)을 받아 → 재빌드 → F7 재평가 → **좋아졌을 때만 채택**(언덕 오르기). 반복 상한과 **토큰 예산 상한**. 여기서 처음 `thread → model` 의존이 생긴다.
- **왜 지금: 평가가 없으면 수리는 환각이다** — 좋아졌는지 말할 수 없으니까. F9.2가 "진다"를 숫자로 냈고 F9.3이 수정 가능한 표현을 냈다.
- **안 하는 것:** 강화학습·유전 알고리즘 · DSPy식 프롬프트 자동 탐색 · 툴 자동 생성 · 무한 예산.
- **검증:** **모든 반복의 성적표를 남긴다**(단조 증가하는지, 어디서 멈추는지). 개선이 없으면 그 사실을 노트에 그대로 쓴다.
- **벽 → 다음(열린 질문):** 뽑힌 그래프는 **그 데이터셋에 과적합됐나?** 홀드아웃 분할이 필요하다.

## 진행 방식
- **V0 → V1 → …** 순서로 한 단계씩. 각 단계에서 구현 + `bun:test` + `docs/notes/NN-*.md` 분석 노트까지 완주하고 커밋 후 멈춘다.
- 커밋 전 `bun run verify`(typecheck + biome + test) 그린.
- 커밋 메시지: conventional, 본문에 참조한 Python 원본 파일 명시, co-author 트레일러.

## 링의 의존 규칙 (F2.2에서 확정)
`@ariadne/core`는 **런타임 deps 0**을 유지한다. 링에 무엇을 두고 무엇을 core에 둘지는 한 문장으로 정한다 — **"채널에 사는 것만 core에 둔다."** `ToolCall`은 messages 채널에 실려 다니므로 core, 툴 선언(JSON Schema)·zod는 프로바이더용 산출물이라 링이다. 링끼리도 **서로를 모르는 쪽을 고른다**: `@ariadne/tools`는 `@ariadne/model`을 import하지 않고 구조적 타이핑으로 만나며, 호환 검사는 둘 다 의존하는 `apps/studio`의 `tsc`가 맡는다.

## 파일 구조 (자연히 수렴)
Core 엔진 코드는 **`packages/core/`** 아래에 산다 (`src/`, `test/`). 파일은 필요한 곳에 생기고, 여러 곳에서 쓰이면 추출한다. Core 내부 최종 지향점: `packages/core/src/{constants,errors,types,channels,pregel,graph}/`. 예제/데모는 `examples/`, 분석 노트는 `docs/notes/`. 나머지 링·Studio는 각자 `packages/*`, `apps/*` (→ [VISION.md](VISION.md)).
