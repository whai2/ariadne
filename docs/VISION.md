# Ariadne — 비전 (올인원 에이전트 프레임워크)

## 무엇을 만드나
**Ariadne**는 TypeScript 올인원 에이전트 프레임워크다. 핵심은 바닥부터 재구현한 **LangGraph 스타일 그래프 엔진**이고, 그 위에 에이전트·툴·모델·메모리 같은 **링**과 비주얼 개발 도구 **Studio**를 두른다. 기둥 구성은 [Mastra](https://github.com/mastra-ai/mastra)를 참고했다.

**학습이 1차 목표**다. 그래서 진화식으로 쌓는다 — 각 링은 "왜 프레임워크가 그걸 갖는지" 직접 벽에 부딪히며 도입한다. (예: V1에서 LLM을 붙이자 드러난 "수동 메시지 병합" 문제 → memory/`addMessages`가 필요한 이유.)

## 계층 (안쪽 = 토대)
1. **Core 그래프 엔진** — `@ariadne/core`. 채널 · superstep · StateGraph. Mastra의 **Workflows** 기둥에 해당. 모든 것의 실행 토대. **런타임 의존성 0.**
2. **프레임워크 링**
   - `@ariadne/model` — 모델 라우팅(통합 LLM 인터페이스; Claude 우선).
   - `@ariadne/tools` — 툴 정의/실행.
   - `@ariadne/agent` — LLM+tool 자율 루프 (agent = core 위의 특수한 그래프).
   - `@ariadne/memory` — 대화 히스토리 + RAG + 영속성(checkpointer).
   - Human-in-the-loop — core의 인터럽트로 suspend/resume.
3. **운영** — `@ariadne/evals`, `@ariadne/observability`(트레이싱).
4. **연동** — MCP 서버(에이전트/툴 노출), 배포 어댑터.
5. **Studio** — `@ariadne/studio` (`apps/`). 로컬 비주얼 개발 UI: **그래프 시각화 + invoke 스텝 실행 + 상태/트레이스 관찰**. (LangGraph Studio / Mastra Studio 대응)

> Mastra 기둥 → Ariadne 매핑: Workflows=`core`, Agents=`agent`, Model routing=`model`, Tools=`tools`, Memory·RAG=`memory`, HITL=core 인터럽트, Evals·Observability=운영 패키지, MCP·Deploy=연동, Studio=`apps/studio`.

## 모노레포 구조 (Bun workspaces)
```
ariadne/
├── packages/
│   ├── core/    @ariadne/core    ← 지금 여기 (V1 완료). 런타임 deps 0.
│   ├── model/   @ariadne/model
│   ├── tools/   @ariadne/tools
│   ├── agent/   @ariadne/agent
│   └── memory/  @ariadne/memory
├── apps/
│   └── studio/  @ariadne/studio
├── examples/   docs/
└── package.json (workspaces)   # Biome·tsconfig.base·lefthook·CI는 루트 공유
```
- `@ariadne/core`는 **런타임 의존성 0** 유지. LLM/서드파티 SDK는 바깥 링에만.
- 루트 스크립트가 `bun run --filter '@ariadne/*' <script>`로 각 패키지에 팬아웃.

## 세 트랙 (병렬 성장)
- **Core 트랙 — 지금 집중.** [ROADMAP.md](ROADMAP.md)의 V1~V8 그래프 엔진. 나머지 모든 것의 토대.
- **Studio 트랙 — 조기·최소.** core가 조금이라도 돌면 곧 최소 스튜디오: 그래프를 그려 보고 invoke를 스텝별로 실행/관찰. "그래프가 그려지는" 걸 눈으로 확인하며 학습.
- **Framework 트랙.** core가 충분히 자란 뒤 `model → tools → agent → memory` 순으로. 각 링은 벽이 부를 때 도입.

## 원칙
- **진화식.** 매 단계가 돌아간다. 미리 선언하지 않고 필요할 때 만든다.
- **직접 구현하며 배운다.** Mastra/LangGraph는 목표 지도일 뿐, 가져다 쓰지 않는다.
- **경계.** 엔진은 프레임워크를 모른다. 프레임워크는 엔진 위에 얹힌다. Studio는 둘을 관찰만 한다.
