# AGENTS.md — langgraph-ts

이 파일은 이 저장소에서 작업하는 모든 AI 에이전트 세션이 따라야 할 규칙이다.
(Claude Code는 `CLAUDE.md`를 읽는데, 이 파일로 심링크돼 있어 내용은 동일하다.)

## 이 저장소

LangGraph를 TypeScript로 **바닥부터 재구현**하는 **학습 프로젝트**. 라이브러리 재사용이 목적이 아니라, 내부 구조(채널 · Pregel superstep 루프 · StateGraph 컴파일)를 bottom-up으로 이해하는 것이 목표다.

- **진행 계획·커밋 단위:** [`docs/ROADMAP.md`](docs/ROADMAP.md) (C0~C15). 항상 이 문서를 따른다.
- **참조 원본(Python):** `/Users/no-eunsu/coxwave/langgraph/libs/langgraph/langgraph/` — 읽기 전용 참고. **복붙 금지**, 개념을 이해해 우리식으로 재구성한다.

## 작업 방식 (가장 중요)

- **한 커밋 = 한 개념 = 한 턴.** ROADMAP의 `Cn` 하나씩만 완주하고 커밋 후 멈춘다. 다음 단계를 미리 구현하지 않는다.
- 각 `Cn`의 "완주" = **구현 + `bun:test` 단위 테스트 + `docs/notes/NN-*.md` 분석 노트**.
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
