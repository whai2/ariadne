# LangGraph TS 포팅 — 커밋 단위 로드맵

## Context

이 저장소는 LangGraph를 TypeScript로 **직접 재구현**한다.
목적은 라이브러리 재사용이 아니라 **내부 구조를 bottom-up으로 점진적으로 완전히 이해**하는 것.
따라서 한 번에 구현하지 않고, **개념 단위로 쪼갠 커밋을 여러 턴에 걸쳐** 진행하며 각 단계를 따로 완주·커밋·분석한다.

참조 원본(Python): `/Users/no-eunsu/coxwave/langgraph/libs/`
- 엔진: `libs/langgraph/langgraph/`
- 영속성/직렬화(이번 범위 밖): `libs/checkpoint/langgraph/`

각 커밋(Cn)이 대략 한 작업 단위 = 한 분석 단위. 이 문서를 따라 순서대로 진행한다.

### 확정된 방향
- **구현 방식: 개념 중심 재구성** — async 한 벌만(Python의 sync/async 이중 구현 안 함), 처음엔 JSON serde, 파이썬 파일 레이아웃을 1:1로 따르지 않고 우리식 구조로 재조직, 실제 쓰는 채널/기능만.
- **목표 범위: 실행 엔진까지** — 채널 → Pregel 루프 → 동작하는 StateGraph. (영속성/인터럽트/스트리밍/함수형 API는 이번 로드맵 밖 = 후속 페이즈)
- **메시지 타입: 의존성 없이 자체 구현** — `@langchain/core` 안 씀. 최소 `BaseMessage` 계층을 직접 정의.

### 이번 로드맵에서 의도적으로 제외 (후속 페이즈)
영속성(checkpointer/InMemorySaver), 인터럽트/HITL, 스트리밍 모드(values 외), 함수형 API(`@entrypoint`/`@task`), 서브그래프, managed values(`IsLastStep`/`RemainingSteps`), cache, remote, sync/async 이중화, msgpack serde, 그래프 시각화, retry/timeout 정책.

---

## 핵심 아키텍처 (재구현 시 반드시 보존할 3가지)
1. **채널이 유일한 공유 가변 상태.** 노드는 채널을 직접 만지지 않고, 쓰기는 버퍼링됐다가 **superstep 경계에서 `applyWrites`로만** 반영된다. (step N의 쓰기는 step N+1에서만 보임 — BSP 모델)
2. **superstep = Plan → Execute → Update.** Plan: 트리거된 노드 태스크 계산. Execute: 태스크 동시 실행(읽기는 얼어붙은 값, 쓰기는 버퍼). Update: `applyWrites`로 채널에 반영 → 다음 Plan의 입력.
3. **StateGraph는 순수 sugar.** `compile()`이 노드→`PregelNode`, 엣지→트리거 채널(`EphemeralValue`/`NamedBarrierValue`)로 낮춰서 결국 `Pregel` 객체가 된다. 엔진을 먼저 옳게 만들면 빌더는 그 위의 얇은 컴파일러.

→ **채널 + `applyWrites` + tick 루프**를 먼저 정확히. 그래프 API는 마지막.

---

## 커밋 로드맵 (C0 → C15, 5개 페이즈)

각 커밋: **무엇을 / 참조 / 분석 포인트 / 검증**. 검증은 커밋마다 vitest 단위 테스트 동봉.

### Phase 0 — 스캐폴드
- [ ] **C0 · 프로젝트 셋업**
  - `package.json`(`type: module`), `tsconfig.json`(strict, ESNext/NodeNext), vitest, tsx. 런타임 의존성 0개(devDeps만).
  - 폴더 골격: `src/{constants,errors,types,channels,pregel,graph}/`, `test/`, `docs/notes/`.
  - README에 학습 목적·범위 명시.
  - 검증: `pnpm test`(빈 스위트) + `tsc --noEmit` 통과.

### Phase 1 — 기반 primitive (개념: 공용 어휘)
- [ ] **C1 · 상수/센티넬** — `MISSING` 센티넬, `START`/`END`, `TASKS`, `PUSH`/`PULL`, 네임스페이스 구분자, 실제 쓸 `CONFIG_KEY_SEND`/`CONFIG_KEY_READ`만.
  - 참조: `_internal/_constants.py`, `constants.py`, `checkpoint/serde/types.py`.
  - 분석: 왜 센티넬/예약 채널명이 필요한가.
- [ ] **C2 · 에러** — `EmptyChannelError`, `InvalidUpdateError`, `GraphRecursionError`, `GraphBubbleUp`/`GraphInterrupt`(값싸니 미리 정의), `createErrorMessage` 헬퍼.
  - 참조: `errors.py`.
- [ ] **C3 · 코어 타입** — `Send`(fan-out), `Command`(goto/update 제어흐름), `PregelExecutableTask`/`PregelTaskWrites`+`WritesProtocol`(태스크 자료구조). 엔진이 실제 읽는 필드만 최소로.
  - 참조: `types.py`, `pregel/_algo.py:93,110,120`.
  - 분석: `Send`/`Command`가 제어흐름을 어떻게 표현하는가(=예약 채널 `TASKS`로 흐름).

### Phase 2 — 채널 (개념: 유일한 공유 상태)
- [ ] **C4 · `BaseChannel` + `LastValue`** — 채널 인터페이스(`update`/`get`/`checkpoint`/`fromCheckpoint`/`consume`/`finish`/`isAvailable`) + 기본 채널.
  - 참조: `channels/base.py`, `channels/last_value.py`(작고 정석적).
  - 분석: step당 1회 쓰기 불변식, 라이프사이클 훅. 검증: update→get, 동시쓰기 시 `InvalidUpdateError`.
- [ ] **C5 · `BinaryOperatorAggregate`(리듀서)** — `Annotated[list, add]` 상태키가 컴파일되는 채널.
  - 참조: `channels/binop.py`.
  - 분석: 한 step의 여러 쓰기를 이항연산으로 fold. 검증: `add`로 리스트 누적.
- [ ] **C6 · `Topic` + `EphemeralValue` + `NamedBarrierValue`** — 컴파일러가 쓸 채널들(`TASKS`/fan-out, 엣지 트리거, 다중소스 조인).
  - 참조: `channels/topic.py`, `ephemeral_value.py`, `named_barrier_value.py`.
  - 분석: accumulate vs step마다 clear, 배리어(모든 상류가 써야 available).

### Phase 3 — Pregel 엔진 (개념: BSP superstep 루프) ← 핵심
- [ ] **C7 · read/write 배관** — `PregelNode`(actor 컨테이너: channels/triggers/bound/writers), `ChannelRead`, `ChannelWrite` + `CONFIG_KEY_READ/SEND` 클로저.
  - 참조: `pregel/_read.py`, `pregel/_write.py`.
  - 분석: 노드가 채널을 직접 안 만지고 config 클로저로 읽기/쓰기하는 이유. 검증: 노드가 입력 읽고 쓰기를 버퍼.
- [ ] **C8 · `applyWrites` (Update 단계, 순수함수)** — 트리거 채널 consume → 채널별 쓰기 그룹핑 → `update()` → 버전 증가 → `updatedChannels` 반환.
  - 참조: `pregel/_algo.py:232`.
  - 검증: 손으로 만든 채널/태스크로 쓰기 반영·버전 검증.
- [ ] **C9 · `prepareNextTasks` (Plan 단계, 순수함수)** — PULL 태스크(triggers ∩ updatedChannels) + PUSH 태스크(`TASKS`의 `Send`).
  - 참조: `pregel/_algo.py:349,524`.
  - 검증: 주어진 채널 상태에서 다음에 실행될 노드 집합.
- [ ] **C10 · `PregelLoop`(tick/afterTick) + `PregelRunner`(동시 실행) + 드라이버** — `while loop.tick(): runner.tick(); loop.afterTick()`.
  - 참조: `pregel/_loop.py`, `pregel/_runner.py`, `pregel/main.py`의 stream 루프.
  - 검증: 손으로 배선한 노드/채널이 여러 superstep 거쳐 완료(재귀 한도 도달 시 종료 포함).
- [ ] **C11 · `Pregel` 애플리케이션 객체 — `invoke()`** — 채널+노드+루프+러너 결합, 입력 매핑/출력 추출. **마일스톤: 손으로 만든 Pregel이 end-to-end 실행.**
  - 참조: `pregel/main.py`(`Pregel.__init__`/stream), `pregel/_io.py`.
  - 검증: `input → invoke → output` 왕복.

### Phase 4 — StateGraph 빌더 (개념: sugar → Pregel로 낮춤)
- [ ] **C12 · `StateGraph` 스펙 + 채널 파생** — `addNode`/`addEdge`, 상태 스키마 리듀서에서 채널 파생(Annotated→BinOp, 그 외→LastValue).
  - 참조: `graph/state.py` addNode/addEdge, `_get_channels`.
  - 검증: 스키마→파생 채널 매핑.
- [ ] **C13 · `compile()` → `CompiledStateGraph(Pregel)`** — `attachNode`(노드→`PregelNode` + `branch:to:<key>` EphemeralValue 트리거 + writers), `attachEdge`(단순 엣지→트리거 채널 write, 다중소스→NamedBarrierValue). **마일스톤: 선형 그래프 `START→a→b→END` 실행.**
  - 참조: `graph/state.py:1177,1444,1551`.
- [ ] **C14 · `addConditionalEdges` + 라우터 + `Send` fan-out** — 조건부 분기와 map-reduce. **마일스톤: 분기/팬아웃 그래프 실행.**
  - 참조: `graph/state.py:982`, `graph/_branch.py`.
- [ ] **C15 · (캡스톤) `MessagesState` + `addMessages` + 최소 메시지 타입** — 의존성 없는 `BaseMessage`/`Human`/`AI` 정의 + 메시지 리듀서. 정석 "챗봇형" 그래프를 데모로. **최종 마일스톤: 교과서 LangGraph 예제가 우리 엔진에서 돈다.**
  - 참조: `graph/message.py`.

---

## 검증 전략 (전체)
- **커밋마다 vitest 단위 테스트** 동봉. 순수함수(C8/C9)와 채널(C4~C6)은 특히 격리 테스트가 쉬움.
- **교차검증(선택):** 동일 그래프를 Python LangGraph(`/Users/no-eunsu/coxwave/langgraph`)로 돌려 출력 비교, 또는 공식 `langgraphjs`를 레퍼런스로 대조. 동작 동치를 학습 확인용으로.
- **분석 기록:** 각 단계 완주 후 `docs/notes/NN-<topic>.md`에 "이 층에서 배운 것" 짧게 기록 → 점진적 이해가 목표이므로 커밋과 함께 남긴다.
- 각 마일스톤(C11/C13/C14/C15)에서 실제 그래프를 돌려 눈으로 확인.

## 진행 방식
- **C0 → C1 → …** 순서로 하나씩. 각 단계에서 해당 커밋을 완주(구현+테스트+분석노트)하고 커밋 후 정지.
- 커밋 메시지는 `feat(channels): LastValue …` 식 conventional, 본문에 참조 원본 파일 명시.
