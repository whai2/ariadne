# Ariadne — 비전 (올인원 에이전트 프레임워크)

## 무엇을 만드나
**Ariadne**는 TypeScript 올인원 에이전트 프레임워크다. 핵심은 바닥부터 재구현한 **LangGraph 스타일 그래프 엔진**이고, 그 위에 에이전트·툴·모델·메모리 같은 **링**과 비주얼 개발 도구 **Studio**를 두른다. 기둥 구성은 [Mastra](https://github.com/mastra-ai/mastra)를 참고했다.

**학습이 1차 목표**다. 그래서 진화식으로 쌓는다 — 각 링은 "왜 프레임워크가 그걸 갖는지" 직접 벽에 부딪히며 도입한다. (예: V1에서 LLM을 붙이자 드러난 "수동 메시지 병합" 문제 → memory/`addMessages`가 필요한 이유.)

## 아리아드네의 실 — 이 프레임워크의 정체성

이름이 먼저 있었고, 뜻은 나중에 왔다.

미로 속의 테세우스에게 아리아드네가 준 것은 무기가 아니라 **실**이었다. 헤맨 자리를 되짚을 수 있게 하는 것. 이 프레임워크가 하려는 일이 정확히 그것이다.

**범용 에이전트(ReAct)는 미로를 헤매는 방식으로 문제를 푼다.** 매 스텝 모델에게 "다음에 뭘 할까"를 묻는다. 그래서 유연하지만 **비싸고 비결정적**이다. 그런데 같은 종류의 태스크를 여러 번 풀게 해보면, 그 헤맨 발자국에는 **반복되는 모양**이 있다.

> **아리아드네의 실 = 범용 에이전트의 성능을 먼저 측정하고(evals), 그 실행 궤적(traces)에서 반복되는 구조를 뽑아내 그래프로 응고시키고, 같은 자로 다시 재서 "같은 성능"임을 증명하는 것.** 헤맨 발자국이 실이 되고, 실이 길이 된다.

그래서 이 저장소의 부품들은 전부 그 목적지의 부품이다:

| 부품 | 실에서 맡는 역할 |
|---|---|
| `core` 그래프 엔진 | **출력의 형식.** 실이 뽑아내는 것이 그래프다. |
| `model`·`tools`·`agent` | **입력의 주체.** 측정 대상이 되는 범용 에이전트. |
| `observability` | **입력의 재료.** 궤적 코퍼스를 남긴다. |
| `evals` | **판정.** "같은 성능"을 정의하는 유일한 자. |
| `memory`·체크포인터 | **연속성.** 여러 run에 걸친 궤적을 잇는다. |
| `thread` | **실 그 자체.** 궤적 → 그래프 → 코드. |
| Studio | **눈.** 발자국과 길을 한 화면에서 본다. |

"같은 성능"은 숫자로 못박는다 — 같은 데이터셋·같은 반복 수에서 **성공률이 베이스라인 이상**이면서 **스텝과 토큰은 더 적을 것.** 즉 실의 목표는 "더 똑똑한 에이전트"가 아니라 **"같은 답을 더 싸고 더 예측 가능하게 내는 그래프"**다.

## 계층 (안쪽 = 토대)
1. **Core 그래프 엔진** — `@ariadne/core`. 채널 · superstep · StateGraph. Mastra의 **Workflows** 기둥에 해당. 모든 것의 실행 토대. **런타임 의존성 0.**
2. **프레임워크 링**
   - `@ariadne/model` — 모델 라우팅(통합 LLM 인터페이스; Claude 우선).
   - `@ariadne/tools` — 툴 정의/실행.
   - `@ariadne/agent` — LLM+tool 자율 루프 (agent = core 위의 특수한 그래프). 서브에이전트(= 노드가 그래프인 것)와 워크플로우도 여기 산다.
   - `@ariadne/mcp` — 외부 MCP 서버의 툴을 `Tool`로 끌어온다(툴 정의의 두 번째 입구). 반대 방향(우리를 서버로 노출)은 5번 "연동".
   - `@ariadne/memory` — 장기 기억(episodes·facts) + 실행 상태 영속(checkpointer).
   - Human-in-the-loop — **인터럽트 없이** 승인 게이트로. 멈춤 = 답 없는 `tool_use`를 남기고 run이 끝난다 / 재개 = 같은 상태로 새 run. (F3.3에서 실측으로 확인 — 당초 "core 인터럽트" 계획은 필요 없었다.)
3. **운영** — `@ariadne/observability`(트레이싱·스팬), `@ariadne/evals`(데이터셋·메트릭·성적표). 둘 다 **런타임 deps 0**을 지킨다. 트레이싱은 **자체 구현**이고, 어휘(`gen_ai.*`)만 OpenTelemetry GenAI semantic conventions에서 빌린다 — OTel SDK도 OTLP 전송도 안 쓴다. Langfuse·[deepeval](https://github.com/confident-ai/deepeval)은 **설계 참고 자료**다.
4. **실** — `@ariadne/thread`. 2·3층의 산출물을 먹고 1층(그래프)을 뱉는다. **이 프레임워크에서 유일하게 "위에서 아래로" 흐르는 패키지**이며, 그래서 마지막에 온다.
5. **연동** — MCP 서버(에이전트/툴 노출), 배포 어댑터.
6. **Studio** — `@ariadne/studio` (`apps/`). 로컬 비주얼 개발 UI: **그래프 시각화 + invoke 스텝 실행 + 상태/트레이스 관찰**. (LangGraph Studio / Mastra Studio 대응)

> Mastra 기둥 → Ariadne 매핑: Workflows=`core`, Agents=`agent`, Model routing=`model`, Tools=`tools`, Memory·RAG=`memory`, HITL=승인 게이트, Evals·Observability=운영 패키지, MCP·Deploy=연동, Studio=`apps/studio`. **`thread`는 대응이 없다 — 우리 고유다.**

## 모노레포 구조 (Bun workspaces)
```
ariadne/
├── packages/
│   ├── core/            @ariadne/core            V1~V8 완료. 런타임 deps 0.
│   ├── model/           @ariadne/model           F1
│   ├── tools/           @ariadne/tools           F2
│   ├── agent/           @ariadne/agent           F3 · F8(서브에이전트·워크플로우)
│   ├── mcp/             @ariadne/mcp             F3.2
│   ├── memory/          @ariadne/memory          F4 · F5(체크포인터). deps 0.
│   ├── observability/   @ariadne/observability   F6. deps 0.
│   ├── evals/           @ariadne/evals           F7. deps 0.
│   └── thread/          @ariadne/thread          F9. 아리아드네의 실.
├── apps/
│   └── studio/          @ariadne/studio
├── examples/   docs/
└── package.json (workspaces)   # Biome·tsconfig.base·lefthook·CI는 루트 공유
```
- `@ariadne/core`는 **런타임 의존성 0** 유지. LLM/서드파티 SDK는 바깥 링에만.
- 의존 방향 (**역방향 없음**):
  `core ← {model, tools, memory} ← agent` · `mcp → {core, tools}` ·
  `observability → core` · `evals → {core, observability}` ·
  `thread → {core, evals, observability}` (+ `model`은 **F9.4 수리 루프에서 처음** 붙는다).
  **`thread`만이 다른 패키지의 산출물을 소비한다.**
- 루트 스크립트가 `bun run --filter '@ariadne/*' <script>`로 각 패키지에 팬아웃.

## 네 트랙
- **Core 트랙 — 완료(V1~V8).** 그래프 엔진. 이제 **회귀 안전망**이다.
- **Framework 트랙 — F1~F5.** `model → tools → agent → memory → 영속성·세션`. 각 링은 벽이 부를 때 도입.
- **Studio 트랙 — 상시 병렬.** core가 조금이라도 돌면 곧 눈으로 확인. 각 단계가 요구하는 관찰 API를 core에 되먹인다.
- **Ops·Thread 트랙 — F6~F9.** 관측 → 평가 → 워크플로우·서브에이전트 → 실. **이 트랙의 도착지가 아리아드네의 실이고, 앞의 세 트랙은 전부 그 부품이다.**

## 원칙
- **진화식.** 매 단계가 돌아간다. 미리 선언하지 않고 필요할 때 만든다.
- **직접 구현하며 배운다.** Mastra/LangGraph/Langfuse/deepeval은 목표 지도일 뿐, 가져다 쓰지 않는다.
- **측정이 먼저다.** 무엇을 좋게 만들려면 먼저 그것을 재는 자를 만든다. **실은 자 없이는 못 뽑는다.**
- **경계.** 엔진은 프레임워크를 모른다. 프레임워크는 엔진 위에 얹힌다. Studio는 둘을 관찰만 한다.
