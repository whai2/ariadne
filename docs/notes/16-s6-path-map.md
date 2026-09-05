# S6 · 조건부 엣지를 그림에 — V5가 미룬 path_map을 되살리다

## 문제

Studio에서 ReAct 예제를 열면 이렇게 보였다.

```
START ──▶ model      tool ──▶ model
```

**루프가 없다.** 에이전트의 핵심인 `model ⇄ tool` 순환이 그림에서 통째로 빠져 있었다.
RAG의 Send 팬아웃(`retrieve → summarize ×N`)도 마찬가지였다.

원인은 [09번 노트](09-v5-conditional.md)가 예고한 그대로다:

> **path_map 생략.** langgraph `add_conditional_edges`의 세 번째 인자는 시각화·검증
> 편의라 아직 안 만든다. → Studio는 조건 엣지를 **못 그린다**.

## 왜 그냥은 못 그리나

```ts
g.addConditionalEdges("model", (s) => (하는 일에 따라 "tool" 또는 END));
```

**라우터는 런타임 함수다.** 컴파일 타임에 이 함수가 어디로 갈지 알 방법이 없다.
정적 엣지는 `addEdge("a","b")`라 선언 자체가 답인데, 조건부는 선언에 답이 없다.

langgraph도 같은 문제를 만나 같은 답을 냈다 — **선언할 때 후보를 같이 적게 한다.**

```ts
g.addConditionalEdges("model", router, ["tool", END]);
//                                     ^^^^^^^^^^^^^ 그림용
```

## 설계에서 지킨 두 가지

**1. 실행에는 전혀 관여하지 않는다.** `targets`는 검증에도 안 쓴다 — 라우터가 목록 밖으로
가도 막지 않는다. 그림을 위한 힌트일 뿐이고, 진실은 여전히 라우터에 있다.

```ts
g.addConditionalEdges("a", () => END, ["b"]); // 목록엔 b, 실제로는 END
// → END로 간다. 막지 않는다. (테스트로 못박음)
```

**2. 안 적으면 안 그린다.** 없는 정보를 지어내지 않는다.

```ts
g.addConditionalEdges("a", router);          // targets 없음
g.compile().getGraph().edges                 // → 이 엣지는 없다
```

"모르면 비워둔다"가 "그럴듯하게 채운다"보다 낫다. 그림이 거짓말하면 관찰 도구가 아니다.

## GraphView가 `kind`를 갖게 됐다

```ts
export interface GraphEdge {
  from: string;
  to: string;
  kind?: "static" | "conditional";
}
```

정적 엣지에도 `kind: "static"`을 **명시적으로** 채운다. 소비자가 기본값을 추론할 필요가
없게 — 이 때문에 기존 `observe.test.ts` 하나를 갱신했다(의도된 API 확장).

Studio는 이걸로 화살표를 나눈다:

```
정적    a --> b     항상 간다
조건부  a -.-> b    라우터가 고를 수도 있다
```

## 결과

```
ReAct   __start__ ---> model
        tool      ---> model      ← 돌아오는 길(정적)
        model     -.-> tool       ← 나가는 길(조건부)
        model     -.-> __end__
                  ⇒ 둘이 합쳐져 순환이 그려진다

RAG     retrieve  -.-> summarize  ← Send 팬아웃도 보인다
```

Send도 같은 방식으로 적어준다. `Send("summarize", d)`가 라우터 반환값이므로 조건부와
구분할 이유가 없다 — **"런타임에 정해지는 행선지"라는 점에서 같은 것**이다.

## Studio가 core를 진화시킨 다섯 번째 사례

이 트랙의 패턴이 또 반복됐다.

| 단계 | Studio가 요구한 것 | core에 생긴 것 |
|---|---|---|
| S1 | 그래프를 그리고 싶다 | `getGraph()` · `stream()` |
| S2 | 채널을 보고 싶다 | `BaseChannel.kind` · `ChannelSnapshot` |
| S5 | 진짜 모델을 쓰고 싶다 | (없음 — 관찰 API가 그대로 통했다) |
| **S6** | **루프를 보고 싶다** | **`path_map` · `GraphEdge.kind`** |

S5에서 아무것도 요구하지 않았던 게 오히려 신호였다 — 챗은 기존 그래프와 모양이 같아서
관찰 층이 그대로 통했다. 반면 **모양이 다른 것을 보려니** core가 모자랐다.

## 남은 것

- **Command의 goto는 여전히 안 그려진다.** 노드가 반환값으로 행선지를 정하는 경로인데,
  라우터보다도 정적 분석이 어렵다(반환값이 노드 본문 안에 있다). 필요해지면 같은 방식으로
  선언하게 하면 된다.
- **다중 라우터**를 한 source에 걸면 targets가 합집합으로 합쳐진다. 어느 라우터의 것인지는
  구분 안 한다 — 지금은 그럴 이유가 없다.

## 검증

- core: `getGraph()`가 kind를 채운다 · 조건부 대상이 나온다 · **안 적으면 안 나온다** ·
  **targets가 실행을 바꾸지 않는다**(4 케이스, `observe.test.ts`)
- studio: ReAct 루프가 보인다 · RAG 팬아웃이 보인다 · mermaid가 점선으로 옮긴다

## 참조

- langgraph: `graph/state.py`의 `add_conditional_edges(source, path, path_map)`
- 우리: [`stateGraph.ts`](../../packages/core/src/graph/stateGraph.ts)(`branchTargets`),
  [`pregel/types.ts`](../../packages/core/src/pregel/types.ts)(`GraphEdge`),
  미뤄둔 기록은 [09번 노트](09-v5-conditional.md)
