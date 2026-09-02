# V4 · superstep (BSP) — 가장 큰 전환

## 무엇이 바뀌었나
순차 edge-following → **Plan → Execute → Update superstep**. 이제:
- 노드가 **아웃엣지를 여러 개** 가질 수 있다 → 분기/팬아웃. (V1의 "선형만" 제한 제거)
- 한 superstep에 **여러 노드가 병렬 실행**된다.
- 쓰기는 **버퍼**됐다 스텝 경계에서 `applyWrites`로 **한 번에 반영**. 같은 채널로 온 여러 쓰기는 리듀서가 **fold**.

### 한 superstep (stream 루프)
1. **Plan**: 활성 노드 집합 결정(START의 대상 → 이후엔 직전에 실행된 노드들의 아웃엣지 대상, 중복 제거).
2. **Execute**: 활성 노드 전부 **같은 스냅샷**(스텝 시작 상태)을 읽고 병렬(`Promise.all`) 실행. 반환값(부분 상태)은 버퍼.
3. **Update**: `collectWrites`로 채널키별 값 목록을 모으고 `applyWrites`로 채널에 반영. 리듀서면 여러 값을 fold.
4. 활성 집합이 빌 때까지 반복.

**프리즈 읽기**가 핵심: 같은 스텝의 노드는 서로의 쓰기를 못 본다(step N 쓰기는 N+1에서만 보임 = BSP 불변식).

## V3가 왜 전제였는지 여기서 드러남
다이아몬드 `START→a→{b,c}→d`: b,c가 **한 스텝에 병렬로 같은 채널**(log)에 쓴다.
- 리듀서 채널: 두 쓰기를 fold → `["a","b","c",...]`. ✅
- LastValue: 한 스텝 2개 → **InvalidUpdateError**. ❌ (테스트로 확인)

→ "병렬 쓰기를 합치려면 리듀서" — V3이 V4의 전제였던 이유가 코드로 증명됨.

## StepUpdate 모양 변경
`{ node }` → `{ step, nodes[] }`. 한 스텝에 여러 노드가 돌 수 있으니 당연한 변화. Studio도 "Step N: b · c"로 표시.

## 의도적으로 미룬 것 (정직하게)
- **스케줄링 방식**: 지금은 "활성 노드 집합"을 아웃엣지로 직접 계산한다. langgraph는 이걸 **트리거 채널**(EphemeralValue에 엣지가 쓰고, 그 채널이 갱신되면 노드가 활성)로 구현한다. 그 채널 기반 스케줄링 + `PregelNode`/`ChannelWrite` 정합은 **V7**로 미룸.
- **스태거드 팬인(join)**: 균형 다이아몬드(b,c 동시)는 dedup으로 처리되지만, 서로 다른 스텝에 도착하는 팬인은 **NamedBarrierValue**가 필요 — V7에서.
- 정확히는 langgraph의 "다음에 뭘 실행할지"를 우리는 근사한다. 관찰되는 BSP 동작(병렬·버퍼·fold)은 동일.

## 다음
- **V5**: 조건부 엣지(`addConditionalEdges`) → 런타임 분기 + 루프. (순환+조건 = 에이전트 루프)
- **Studio**: 다이아몬드 예제를 넣으면 처음으로 비선형 그래프가 그려지고 "Step: b · c" 병렬이 보인다(다음 커밋).
