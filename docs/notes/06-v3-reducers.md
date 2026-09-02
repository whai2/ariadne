# V3 · 리듀서 채널 (BinaryOperatorAggregate)

## 무엇이 생겼나
상태 키에 **리듀서**를 선언하면 그 키가 `BinaryOperatorAggregate` 채널로 컴파일된다.
```ts
new StateGraph<State>({
  messages: { reducer: (a, b) => [...a, ...b] }, // 이어붙이기
  count:    { reducer: (a, b) => a + b },        // 합계
})
```
- **스키마 도입**: `StateGraph(schema)` 생성자. 키별 채널 정책(`ChannelSpec`). 선언 안 한 키는 여전히 LastValue로 동적 생성.
- **`BinaryOperatorAggregate`**: 들어오는 값들을 이항 연산으로 접어(fold) **누적**. LastValue와 두 가지가 다름:
  1. **스텝을 넘어 쌓인다** (LastValue는 덮어씀).
  2. **한 스텝에 여러 값이 와도 합쳐진다** (LastValue는 2개면 에러) → 이게 V4 병렬의 전제.

## LastValue vs Reducer (핵심 대조)
같은 그래프(노드가 `{count:1}` 반환)를 두 방식으로:
| 채널 | 결과 |
|---|---|
| LastValue | `count = 1` (매번 덮어씀) |
| Reducer `(a,b)=>a+b` | `count = 2` (0+1+1 누적) |

메시지도 마찬가지: 리듀서를 달면 노드가 `{messages:[newMsg]}`만 반환해도 자동 append.
→ **`accumulate` 예제의 "수동 `[...s.messages, x]`" 고통이 사라진다.**

## 왜 이게 V4의 전제인가
V4에서 두 노드가 병렬로 같은 채널에 쓰면, 그 스텝에 값이 **여러 개** 온다. LastValue는 거부(InvalidUpdateError)하지만, 리듀서 채널은 **fold로 합친다**. 그래서 리듀서가 있어야 병렬 분기가 성립한다. (V2 노트의 "스텝당 1회 불변식은 V4에서 의미"가 여기서 이어짐)

## Studio에서
채널 스냅샷의 `type`이 리듀서 여부로 갈린다: `[BinaryOperatorAggregate]` vs `[LastValue]`. → 다음 커밋에서 예제에 리듀서를 달아 패널에서 직접 확인.

## 아직 미완
- 리듀서의 **초기값(default)** 개념은 아직 없음(입력이 seed 역할). langgraph는 `default`도 지원 — 필요해지면 추가.
- 여러 값을 한 스텝에 접는 기능은 있지만, **실제로 여러 값이 오는 상황은 V4(병렬)** 라야 발생.
