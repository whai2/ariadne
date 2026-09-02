# langgraph-ts

LangGraph를 TypeScript로 **바닥부터 재구현**하는 학습 프로젝트.
목적은 라이브러리 사용이 아니라 **내부 구조(채널 · Pregel superstep 루프 · StateGraph 컴파일)를 bottom-up으로 이해**하는 것.

전체 진행 계획과 커밋 단위는 [docs/ROADMAP.md](docs/ROADMAP.md) 참조.

## 방향
- **개념 중심 재구성** — async 한 벌, 처음엔 JSON serde, 실제 쓰는 채널/기능만.
- **목표 범위: 실행 엔진까지** — 채널 → Pregel 루프 → 동작하는 StateGraph.
- **의존성 없이** — 런타임 의존성 0개, 메시지 타입도 직접 정의.

## 하네스 (Bun 생태계)
| 역할 | 도구 |
|---|---|
| 런타임 · 패키지매니저 · 테스트러너 | **Bun** (`bun install`, `bun test`) |
| 타입 게이트 | **`tsc --noEmit`** (Bun은 타입체크를 하지 않음) |
| lint · format | **Biome** |
| git hooks | **lefthook** (pre-commit: biome, pre-push: typecheck+test) |
| CI | GitHub Actions (`bun run typecheck && bun run check && bun test`) |

## 명령
```bash
bun install        # devDeps 설치 + git hooks 등록(prepare)
bun test           # 테스트
bun run typecheck  # tsc 타입 검사
bun run check      # biome lint + format 검사
bun run verify     # 위 셋 전부 (로컬 CI 게이트)
```

> CI(`.github/workflows/ci.yml`)는 GitHub 원격에 push하면 활성화된다.
