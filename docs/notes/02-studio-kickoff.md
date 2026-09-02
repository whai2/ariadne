# S1 · 최소 스튜디오 (Studio 트랙 시작)

## 무엇을 만들었나
`apps/studio` (`@ariadne/studio`) — Bun.serve로 로컬 서버(:4111)를 띄우고, 브라우저에서:
- **그래프 시각화**: `/api/graph`의 구조를 mermaid로 그림 (CDN, 빌드 없음).
- **스텝 실행/관찰**: 입력 JSON → `/api/run` → `stream()`을 돌려 스텝별 `{node, state}`를 나열.

핸들러는 `createStudio(compiled)` → `{ fetch(req) }` 형태라 서버 없이도 테스트에서 직접 호출된다(포트 불필요). `server.ts`는 `Bun.serve({ fetch })`로 얇게 감싸기만.

## Studio가 core를 진화시킴 (핵심)
최소 스튜디오조차 V1 core엔 없던 **두 가지**를 요구했다:
1. **introspection** — 그래프를 그리려면 구조(노드/엣지)를 읽어야 함 → `CompiledGraph.getGraph()` (langgraph `get_graph()`).
2. **관찰 가능한 실행** — invoke는 최종값만 반환. 스텝을 보려면 중간을 내보내야 함 → `stream()` async generator가 매 스텝 `{node, state}` yield (langgraph `stream()`).
   - 그리고 `invoke = stream을 끝까지 소비한 마지막`으로 재정의. 동작 불변, V1 테스트 그대로 통과.

→ "관찰 도구를 만들려니 엔진에 관찰 훅이 필요해졌다"는, 진화식의 전형적 순간. LangGraph도 정확히 이 두 API를 갖는다.

## 경계 (VISION 원칙 확인)
- **엔진은 스튜디오를 모른다.** core는 `getGraph`/`stream`이라는 일반 관찰 API만 노출. studio를 import하지 않음.
- **스튜디오는 관찰만 한다.** `apps/studio`가 `@ariadne/core`에 의존(workspace:*), 역방향 없음.
- core는 여전히 런타임 의존성 0. studio는 Bun 내장 서버 + CDN mermaid만(런타임 npm 의존성 0).

## 다음 벽
- 지금은 스텝을 "나열"만 함 → **S2**: 실행 중 현재 노드를 그래프에서 강조/재생.
- 샘플 그래프가 하드코딩 → **S3**: 사용자 그래프 로드.
- core가 V4(superstep)로 가면 "다음 실행 노드 집합"이 생기므로, 스튜디오가 병렬 실행을 시각화할 여지가 생김.
