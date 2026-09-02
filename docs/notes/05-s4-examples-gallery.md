# S4 · 예제 그래프 갤러리

## 무엇을 만들었나
스튜디오에 **예제 선택기**를 붙였다. 하드코딩 한 개 → 큐레이션된 여러 예제를 드롭다운으로 골라 관찰.
- `apps/studio/src/examples.ts` — `Example[]`(id/name/description/sampleInput/graph). 타입 있는 그래프를 `example()` 헬퍼로 만들고 경계에서 타입 지움.
- studio API 다중 그래프화: `GET /api/examples`, `GET /api/graph?id`, `POST /api/run {id,input}`.
- 페이지에 `<select>` + 설명 + 선택 시 그래프 재렌더 + 샘플입력 자동 채움.

## 예제 5종 (V1/V2 범위에서 관찰 가능한 케이스)
| id | 무엇을 보나 |
|---|---|
| **linear** | 기본 순차, 채널 2개(text/steps) |
| **grow** | 노드가 새 키를 쓰면 **채널이 생김** → 스텝마다 채널 수 1→2→3 |
| **accumulate** | 각 노드가 `[...s.messages, x]`로 **수동 누적**. LastValue라 손으로 합쳐야 함 → V3 동기 |
| **preserve** | 일부 키만 반환해도 **나머지 채널 값 유지** |
| **long** | 5노드 체인 → **스텝을 길게** 관찰 |

## 이 예제들이 드러내는 것
- **채널은 동적 생성**: `grow`에서 채널이 스텝마다 늘어나는 게 눈에 보임. (langgraph는 스키마로 미리 선언 → V3에서 우리도 스키마화)
- **LastValue의 한계**: `accumulate`가 "왜 리듀서가 필요한가"를 몸으로 보여줌 — 누적을 매번 손으로. V3에서 `messages`에 리듀서를 달면 `return {messages:[x]}`만으로 자동 append.
- **아직 못 보는 것**: 분기(V5)·병렬/팬인(V4)·Send(V6)는 엔진에 없어 예제로 못 만듦. 그 단계에서 예제도 늘어난다.

## 경계
core는 안 건드렸다(getGraph/stream만으로 충분). 예제/선택기는 전부 studio 안. core 여전히 studio를 모름.
