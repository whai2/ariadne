# V5 · 조건부 엣지

## 무엇이 바뀌었나
`addConditionalEdges(source, router)` 추가. `router(state)`가 **런타임에** 다음 노드(들)를 고른다. 고정 엣지만으론 불가능했던 **조건 분기 · 루프**가 이제 돈다.
- router 반환: 노드명 하나 · 배열(팬아웃) · `END`. async 허용.
- 정적 엣지와 **공존**(같은 source에 둘 다 걸면 합집합). START에도 걸어 **조건부 진입** 가능.

## 내부 구현
- 빌더: `branches = Map<source, Router[]>` 추가([stateGraph.ts](../../packages/core/src/graph/stateGraph.ts)). compile이 이걸 `CompiledGraph`로 넘긴다.
- 실행: 순수 헬퍼 [`nextTargets(source, state)`](../../packages/core/src/pregel/algo.ts) = **정적 엣지 ∪ 라우터 결과**(END 제외). 라우터가 모르는 노드를 반환하면 즉시 에러.
- `stream` 루프에서 **초기 활성**과 **다음 활성**을 모두 `nextTargets`로 계산하도록 통일. 라우터는 그 스텝 쓰기가 반영된 **직후 상태(`stateNow`)**를 보고 결정한다(superstep 경계에서 실행).

```
V4:  다음 활성 = 실행 노드들의 정적 아웃엣지
V5:  다음 활성 = 실행 노드들의 (정적 아웃엣지 ∪ router(stateNow) 결과)
```

## 08 분류 지도에서 켠 칸
[08 taxonomy](08-control-flow-taxonomy.md)의 ❌ 중 셋이 켜졌다:
- 나가기 **[선택]** — router가 후보 중 고름 ✅
- 종료 **[조기]** — router가 `END` 반환 → 조건부 종료 ✅
- 나가기 **[순환→실용 루프]** — router가 이전 노드/자신을 가리켜 조건 만족까지 반복 ✅

여전히 ❌: 나가기[동적](V6 Send), 들어오기[대기](V7 NamedBarrierValue).

## 검증 (test/conditional.test.ts)
짝/홀 라우팅 · 자기 루프(0→3, 3번 실행) · 배열 팬아웃 · 조건부 진입 · 정적∪조건부 공존 · 무한 루프→재귀 한도 · 모르는 노드 에러 · 진입 없음 에러. (8 케이스)

## 미룬 것 (정직)
- **path_map 생략.** langgraph `add_conditional_edges`의 세 번째 인자(라우터 출력→노드 매핑)는 시각화·검증 편의라 아직 안 만든다. → Studio는 조건 엣지를 **못 그린다**(getGraph는 정적 엣지만). Studio 시각화는 별도 트랙에서.
- **라우터 결과를 채널 쓰기로 낮추는 건 V7.** 지금은 라우터를 활성 집합 계산에 직접 실행한다(원본은 `branch:to` 채널에 씀). 개념 우선, 구조 정합은 V7.

## 벽 → 다음
정적으로 **이름 아는 노드**로만 갈 수 있다. 입력 리스트를 받아 **런타임에 N개를 동적 생성**해 병렬 처리(map-reduce)하는 건 불가 → **V6 Send**.

## 참조
- langgraph: `graph/_branch.py`(Branch), `graph/state.py:982`(add_conditional_edges).
- 우리: [`graph/stateGraph.ts`](../../packages/core/src/graph/stateGraph.ts), [`pregel/algo.ts`](../../packages/core/src/pregel/algo.ts), [`graph/types.ts`](../../packages/core/src/graph/types.ts)(Router).
