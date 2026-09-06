# langgraph-ts 로드맵 — 진화식 (walking skeleton)

## Context

LangGraph를 TypeScript로 **바닥부터 재구현**하며 내부 구조를 학습한다.
학습 방식은 **진화식**이다: 처음부터 끝까지 **돌아가는 가장 작은 엔진**으로 시작해, 매 단계마다 *여전히 돌아가는* 채로 조금씩 진짜 langgraph 구조로 탈피시킨다.

> 이전 버전은 의존성 순서로 주춧돌을 먼저 까는 **bottom-up 계층식**이었다. 그건 "전체 구조를 이미 아는 사람"의 선언 방식이라, 완성이 마지막에 몰려 "작게 돌아가는 걸 보며 배운다"는 목표와 어긋났다. 그래서 **순서를 계층식 → 진화식으로 재구성**했다. (도착지 지도인 "아키텍처 불변식"은 그대로 유지.)

참조 원본(Python): `/Users/no-eunsu/coxwave/langgraph/libs/langgraph/langgraph/` — 읽기 전용 참고, **복붙 금지**.

> **이 문서는 진행 계획의 원본이다.** 프로젝트는 모노레포이며, `V1~V8`은 `packages/core`(`@ariadne/core`) 그래프 엔진(**완료**), `F1~`은 그 위의 프레임워크 링을 다룬다. 전체 비전(올인원 프레임워크 · Studio · 3 트랙)은 [VISION.md](VISION.md) 참조. **지금 집중 = Framework 트랙.**

## 이 방식의 규칙

- **매 단계가 실행된다.** V1부터 `bun test`로 실제 그래프가 도는 걸 본다.
- **개념은 "필요해서" 등장한다.** `MISSING` 센티넬은 V2(채널에 '비어있음'이 처음 필요할 때), `TASKS`/`PUSH` 상수는 V6(Send가 생길 때) 태어난다. **미리 `constants.ts`를 채워두지 않는다.** 여러 곳에서 쓰이기 시작하면 그때 모듈로 추출(정리 리팩터).
- **리팩터가 곧 학습.** "순차 실행 → superstep"(V4)처럼 직접 벽에 부딪힌 뒤 langgraph가 왜 그 복잡성을 갖는지 이해한다.
- **회귀 안전망.** 각 단계는 이전 단계의 예제 테스트를 깨지 않는다. 예제와 테스트는 계속 쌓인다.

### 확정된 방향
- **개념 중심 재구성** — async 한 벌, 처음엔 JSON serde, 실제 쓰는 것만.
- **런타임 의존성 0개** — 메시지 타입도 직접 정의.
- **목표 범위: 실행 엔진까지** — 채널 → Pregel 루프 → 동작하는 StateGraph. (영속성/인터럽트/스트리밍/함수형 API는 범위 밖.)

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
- [ ] **S3 · 스텝 하이라이트/재생** — 실행 중 현재 노드를 그래프에서 강조, 스텝 넘기기.
- [x] **S4 · 예제 그래프 갤러리** — 큐레이션된 예제 5종을 드롭다운으로 선택/관찰(linear/grow/accumulate/preserve/long). (사용자 파일 로드는 이후)
- 이후 core가 커지면: 채널/superstep 상태 관찰, 인터럽트 재개 등.

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

#### F2.3 · 스튜디오 — 문자열 규약을 걷어낸다 (예정)
`react` 예제가 진짜 `toolCalls`/`tool` 메시지로 돌고, Chat에 `tools` 모양이 생긴다. `studio.test.ts`의 가짜 규약 assert를 **의도적으로 대체**하는 첫 사례(회귀 안전망의 첫 예외).

### F3 · 에이전트 링 — `@ariadne/agent` (예정)
model+tools 자율 루프. **agent = core 위의 특수한 그래프**라는 걸 보이는 단계 — 새 실행 개념 없이 StateGraph 조립으로 끝나야 한다.

### F4 · 메모리 링 — `@ariadne/memory` (예정)
대화 히스토리 + RAG. 영속성(checkpointer)은 core의 범위 밖이었으므로 여기서 처음 부딪힌다.

## 진행 방식
- **V0 → V1 → …** 순서로 한 단계씩. 각 단계에서 구현 + `bun:test` + `docs/notes/NN-*.md` 분석 노트까지 완주하고 커밋 후 멈춘다.
- 커밋 전 `bun run verify`(typecheck + biome + test) 그린.
- 커밋 메시지: conventional, 본문에 참조한 Python 원본 파일 명시, co-author 트레일러.

## 링의 의존 규칙 (F2.2에서 확정)
`@ariadne/core`는 **런타임 deps 0**을 유지한다. 링에 무엇을 두고 무엇을 core에 둘지는 한 문장으로 정한다 — **"채널에 사는 것만 core에 둔다."** `ToolCall`은 messages 채널에 실려 다니므로 core, 툴 선언(JSON Schema)·zod는 프로바이더용 산출물이라 링이다. 링끼리도 **서로를 모르는 쪽을 고른다**: `@ariadne/tools`는 `@ariadne/model`을 import하지 않고 구조적 타이핑으로 만나며, 호환 검사는 둘 다 의존하는 `apps/studio`의 `tsc`가 맡는다.

## 파일 구조 (자연히 수렴)
Core 엔진 코드는 **`packages/core/`** 아래에 산다 (`src/`, `test/`). 파일은 필요한 곳에 생기고, 여러 곳에서 쓰이면 추출한다. Core 내부 최종 지향점: `packages/core/src/{constants,errors,types,channels,pregel,graph}/`. 예제/데모는 `examples/`, 분석 노트는 `docs/notes/`. 나머지 링·Studio는 각자 `packages/*`, `apps/*` (→ [VISION.md](VISION.md)).
