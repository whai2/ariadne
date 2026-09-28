# Ariadne

TypeScript **올인원 에이전트 프레임워크**(Mastra 스타일)를 바닥부터 재구현하며 배우는 **학습용 모노레포**.
핵심은 LangGraph 스타일 **그래프 엔진**(`@ariadne/core`)이고, 그 위에 프레임워크 링과 비주얼 도구 **Studio**를 두른다.

- 전체 비전: [docs/VISION.md](docs/VISION.md)
- 지금 집중(Core 엔진) 진행 계획: [docs/ROADMAP.md](docs/ROADMAP.md) — 진화식 V0~V8

## 모노레포 (Bun workspaces)
```
packages/core   @ariadne/core   ← 그래프 엔진 (런타임 deps 0)
packages/*      model·tools·agent·mcp·memory·observability·evals
apps/studio     @ariadne/studio ← 비주얼 개발 UI (그래프 시각화 + 스텝 실행)
```

## 실행
```bash
bun install       # 워크스페이스 설치 + git hooks
bun run verify    # typecheck + biome + test (전 패키지)
bun run studio    # Studio 서버 → http://localhost:4111
```

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

### 자체 트레이싱 (F6.2)

`traceRun(trace => createAgent({ model, tools, trace }), input, { collector })`로
run → superstep → node → model/tool 트리를 수집한다. `collector`는
`new TraceCollector()`로 만들고 `spans()` / `tree(traceId)`로 조회한다.
현재 메모리 수집까지 구현됐으며 영구 저장·Studio 트레이스 UI는 후속 단계다.

키 없이 실행: `bun run --filter '@ariadne/observability' example`.
설계·실패 처리·사용법: [F6.2 분석 노트](docs/notes/37-f6_2-span-tree.md).
