# AGENTS.md — langgraph-ts

이 파일은 이 저장소에서 작업하는 모든 AI 에이전트 세션이 따라야 할 규칙이다.
(Claude Code는 `CLAUDE.md`를 읽는데, 이 파일로 심링크돼 있어 내용은 동일하다.)

## 이 저장소

**Ariadne** — TypeScript 올인원 에이전트 프레임워크(Mastra 스타일)를 **바닥부터 재구현**하며 배우는 **학습용 모노레포**. 핵심은 LangGraph 스타일 그래프 엔진이고, 그 위에 프레임워크 링(model/tools/agent/memory)과 비주얼 도구 Studio를 두른다.

- **전체 비전:** [`docs/VISION.md`](docs/VISION.md) — 올인원 프레임워크 · Studio · 3 트랙(Core/Studio/Framework).
- **지금 집중 = Core 트랙.** 그래프 엔진(`packages/core`, `@ariadne/core`). 진행 계획·커밋 단위: [`docs/ROADMAP.md`](docs/ROADMAP.md) — **진화식 V0~V8**. 항상 이 문서를 따른다.
- **모노레포:** Bun workspaces. 엔진=`packages/core`(런타임 deps 0 유지), 링=`packages/*`, Studio=`apps/*`. 루트 스크립트가 `bun run --filter '@ariadne/*'`로 팬아웃.
- **참조 원본(Python):** `/Users/no-eunsu/coxwave/langgraph/libs/langgraph/langgraph/` — 읽기 전용 참고. **복붙 금지**, 개념을 이해해 우리식으로 재구성한다.

## 작업 방식 (가장 중요)

- **진화식.** 매 단계는 *여전히 돌아가는* 엔진이어야 한다. bottom-up으로 부품만 쌓지 말 것.
- **한 커밋 = 한 단계 = 한 턴.** ROADMAP의 `Vn` 하나씩만 완주하고 커밋 후 멈춘다. 다음 단계를 미리 구현하지 않는다.
- **개념은 필요할 때 등장.** 상수/센티넬/에러를 미리 선언하지 말고, 그 단계에서 처음 필요할 때 만든다. 여러 곳에서 쓰이면 모듈로 추출.
- **회귀 안전망.** 각 단계는 이전 단계의 예제 테스트를 깨지 않는다.
- 각 `Vn`의 "완주" = **구현 + `bun:test` 단위 테스트 + `docs/notes/NN-*.md` 분석 노트**.
- 커밋 전 반드시 **`bun run verify`** (typecheck + biome + test) 그린.
- 커밋 메시지: conventional(`feat(channels): ...`), 본문에 참조한 Python 원본 파일 명시, co-author 트레일러.

## 방향/제약 (임의로 바꾸지 말 것)

- **개념 중심 재구성** — async 한 벌(sync/async 이중화 안 함), 처음엔 JSON serde, 실제 쓰는 채널/기능만.
- **런타임 의존성 0개.** 메시지 타입도 `@langchain/core` 없이 직접 정의.
- **범위: 실행 엔진까지** (채널 → Pregel 루프 → 동작하는 StateGraph). 영속성/인터럽트/스트리밍/함수형 API는 이번 범위 밖.

## 아키텍처 불변식 (깨지 말 것)

1. **채널이 유일한 공유 가변 상태.** 노드는 채널을 직접 만지지 않고, 쓰기는 버퍼링됐다 superstep 경계에서 `applyWrites`로만 반영된다.
2. **superstep = Plan → Execute → Update.** (step N의 쓰기는 step N+1에서만 보임 — BSP)
3. **StateGraph는 순수 sugar** — `compile()`이 노드→`PregelNode`, 엣지→트리거 채널로 낮춰 결국 `Pregel`이 된다.
4. **폴더 경계는 한 방향.** `공용 어휘(constants·errors·send·channels/) ← pregel/(엔진) ← graph/(사용자 API)`. **`pregel/`은 `graph/`를 import하지 않는다** — 엔진은 StateGraph도 Command도 모르고, 접점은 `PregelSpec` 하나뿐이다. `graph/`는 `../pregel` 배럴만 쓴다(내부 파일 직접 import 금지). `test/architecture.test.ts`가 강제한다.

## 하네스 (Bun 생태계)

| 역할 | 도구 | 비고 |
|---|---|---|
| 런타임 · 패키지매니저 · 테스트 | **Bun** | `bun install`, `bun test` |
| 타입 게이트 | **`tsc --noEmit`** | Bun은 타입체크를 하지 않음. TypeScript 7(native tsc). |
| lint · format | **Biome** | 2-space · width 100 · double quote (자동 강제) |
| git hooks | **lefthook** | pre-commit: biome / pre-push: typecheck+test |

명령: `bun test` · `bun run typecheck` · `bun run check` · `bun run verify`(전부).

## 코드 컨벤션

- ESM. `moduleResolution: "Bundler"`라 상대 import는 확장자 생략 가능.
- `verbatimModuleSyntax`: 타입 전용 import는 `import type`.
- strict + `noUncheckedIndexedAccess` 등 전부 on. `any` 지양.
- **작은 순수 함수 선호** (특히 `applyWrites` / `prepareNextTasks`는 순수하게). 테스트는 커밋마다.
- tsconfig `types: ["bun"]` — `bun:test` 등 Bun 글로벌 타입은 여기서 온다.
