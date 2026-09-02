# langgraph-ts 로드맵 — 진화식 (walking skeleton)

## Context

LangGraph를 TypeScript로 **바닥부터 재구현**하며 내부 구조를 학습한다.
학습 방식은 **진화식**이다: 처음부터 끝까지 **돌아가는 가장 작은 엔진**으로 시작해, 매 단계마다 *여전히 돌아가는* 채로 조금씩 진짜 langgraph 구조로 탈피시킨다.

> 이전 버전은 의존성 순서로 주춧돌을 먼저 까는 **bottom-up 계층식**이었다. 그건 "전체 구조를 이미 아는 사람"의 선언 방식이라, 완성이 마지막에 몰려 "작게 돌아가는 걸 보며 배운다"는 목표와 어긋났다. 그래서 **순서를 계층식 → 진화식으로 재구성**했다. (도착지 지도인 "아키텍처 불변식"은 그대로 유지.)

참조 원본(Python): `/Users/no-eunsu/coxwave/langgraph/libs/langgraph/langgraph/` — 읽기 전용 참고, **복붙 금지**.

> **이 문서는 Core 트랙이다.** 프로젝트는 모노레포이며, 이 로드맵(V1~V8)은 `packages/core`(`@ariadne/core`) 그래프 엔진을 다룬다. 전체 비전(올인원 프레임워크 · Studio · 3 트랙)은 [VISION.md](VISION.md) 참조. **지금 집중 = Core 트랙.**

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
3. **StateGraph는 순수 sugar** — `compile()`이 Pregel로 낮춤. (V7에서 원본 구조에 정합)

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

### V5 · 조건부 엣지
- **도는 것:** `addConditionalEdges(source, router)` — router(state)→다음 노드명. 조건 분기/루프 실행.
- **내부:** 라우터 결과를 해당 트리거 채널 쓰기로.
- **참조:** `graph/_branch.py`, `graph/state.py:982`.
- **검증:** 짝/홀 라우팅, 자기 루프.
- **벽 → 다음:** 정적으로 이름 아는 노드만 가능 — 런타임 N개 동적 생성 불가.

### V6 · Send 팬아웃 (map-reduce)
- **도는 것:** 입력 리스트 → 각 항목을 동적 병렬 처리 → 리듀서로 취합.
- **내부:** 노드/라우터가 `Send(node, arg)` 반환 → 예약 `TASKS` 채널 → 다음 tick에 동적 **PUSH** 태스크로 스케줄.
- **새 개념·상수:** **`TASKS`, `PUSH`, `PULL`**(대역 내 신호 — *필요해서* 등장). `Send`. `Topic` 채널(TASKS 백킹).
- **참조:** `types.py`(Send), `pregel/_algo.py`의 PUSH 처리, `channels/topic.py`.
- **검증:** map-reduce 그래프.
- **벽 → 다음:** 노드 반환/제어흐름이 임시방편 — 원본 구조(Command, PregelNode/ChannelWrite)와 어긋남.

### V7 · Command + compile 정합
- **도는 것:** 앞의 모든 예제가 **원본과 같은 내부 구조**에서 그대로 돎(리팩터 안전망).
- **내부:** 노드 반환을 `Command`(goto+update)로 통일. compile을 실제 구조로: 노드→`PregelNode`(triggers/bound/writers), 엣지→`ChannelWrite`가 `branch:to:<key>` 채널에 씀, 다중소스→`NamedBarrierValue`. 읽기/쓰기는 config 클로저(`CONFIG_KEY_READ/SEND`).
- **새 개념·상수:** `Command`, `CONFIG_KEY_SEND/READ`, `PregelNode`, `ChannelRead/Write`.
- **참조:** `graph/state.py:1444,1551,1577`, `pregel/_read.py`, `pregel/_write.py`.
- **검증:** 회귀(V1~V6 예제 전부 통과) + "우리 코드 ↔ langgraph" 구조 대응.

### V8 · 캡스톤 — MessagesState + addMessages
- **도는 것:** 교과서 챗봇형 그래프(모델 호출은 가짜 함수)에서 대화 상태가 메시지 리스트로 누적.
- **내부:** 의존성 없는 최소 `BaseMessage`/`Human`/`AI` + `addMessages` 리듀서.
- **참조:** `graph/message.py`.

---

## Studio 트랙 (조기·최소, core와 병렬)

Core가 조금이라도 돌면 곧바로 눈으로 관찰. `apps/studio` (`@ariadne/studio`). 각 단계는 core에 필요한 관찰 API를 요구하며 자란다.

- [x] **S1 · 최소 스튜디오** — Bun.serve 로컬 서버(:4111) + 브라우저 UI. 그래프를 mermaid로 시각화 + invoke를 스텝별 실행/관찰.
  - **core를 진화시킴:** `getGraph()`(구조) + `stream()`(스텝 이벤트) 추가. `invoke = stream의 마지막`.
- [x] **S2 · Channels 뷰** — 스텝마다 각 채널의 type/available/value를 패널로. "상태=채널들"을 눈으로. (core에 `BaseChannel.kind` + `ChannelSnapshot` + `stream`이 채널 스냅샷 yield)
- [ ] **S3 · 스텝 하이라이트/재생** — 실행 중 현재 노드를 그래프에서 강조, 스텝 넘기기.
- [x] **S4 · 예제 그래프 갤러리** — 큐레이션된 예제 5종을 드롭다운으로 선택/관찰(linear/grow/accumulate/preserve/long). (사용자 파일 로드는 이후)
- 이후 core가 커지면: 채널/superstep 상태 관찰, 인터럽트 재개 등.

## 진행 방식
- **V0 → V1 → …** 순서로 한 단계씩. 각 단계에서 구현 + `bun:test` + `docs/notes/NN-*.md` 분석 노트까지 완주하고 커밋 후 멈춘다.
- 커밋 전 `bun run verify`(typecheck + biome + test) 그린.
- 커밋 메시지: conventional, 본문에 참조한 Python 원본 파일 명시, co-author 트레일러.

## 파일 구조 (자연히 수렴)
Core 엔진 코드는 **`packages/core/`** 아래에 산다 (`src/`, `test/`). 파일은 필요한 곳에 생기고, 여러 곳에서 쓰이면 추출한다. Core 내부 최종 지향점: `packages/core/src/{constants,errors,types,channels,pregel,graph}/`. 예제/데모는 `examples/`, 분석 노트는 `docs/notes/`. 나머지 링·Studio는 각자 `packages/*`, `apps/*` (→ [VISION.md](VISION.md)).
