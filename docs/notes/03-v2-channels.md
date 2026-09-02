# V2 · 채널로 상태 저장

## 무엇이 바뀌었나
V1에서 상태는 평범한 객체였고 `state = {...state, ...update}`로 덮어썼다. V2는 그 자리에 **채널**을 넣었다.
- 상태의 각 키 = `LastValue` 채널 하나.
- 노드에 넘길 땐 채널들에서 값을 모아 평범한 객체로 조립(`readChannels`), 노드가 돌려준 부분 상태는 각 채널에 씀(`writeToChannels`).
- **겉보기 동작은 동일** — 같은 그래프가 같은 출력. (V1/observe/studio 테스트 그대로 통과 = 회귀 안전망)

## 처음 등장한 개념
- **`MISSING` 센티넬** (`channels/base.ts`): "아직 한 번도 안 써짐". 고유 심볼이라 `undefined`/`null`을 실제 값으로 저장해도 "비어있음"과 구분된다. (채널 테스트로 확인)
- **`EmptyChannelError`** (`errors.ts`): 비어있는 채널을 `get()` 하면.
- **`LastValue`** (`channels/lastValue.ts`): 마지막 값 저장. `get`/`update`/`isAvailable`.
- **`InvalidUpdateError`**: LastValue에 **한 스텝 두 값**이 오면. → 이게 V3 리듀서의 동기.
- **`BaseChannel` 인터페이스**: 엔진은 이 인터페이스로만 채널을 다룬다(구현 교체 가능).

## 왜 채널인가 (V1이 드러낸 벽의 답)
V1의 순진한 덮어쓰기는 "키별로 어떻게 합칠지" 규칙이 없었다. 채널은 **키마다 병합 정책을 캡슐화**한다: LastValue는 "덮어쓰기(단, 스텝당 1회)". 다른 채널로 바꾸면 다른 정책(누적 등)이 된다 → V3.

## 아직 안 쓰이는 부분 (의도된 미완)
- **"스텝당 1회" 불변식**은 sequential(노드 1개/스텝)에선 자연히 지켜져 그래프에서는 안 걸린다. 여러 노드가 같은 채널에 쓰는 **V4(병렬)** 에서 비로소 의미. 지금은 채널 단위 테스트로만 확인.
- 채널은 **동적 생성**(입력/쓰기에서 본 키). langgraph는 스키마로 선언 → **V3에서 스키마화**.
- `checkpoint`/`consume`/`finish` 등 BaseChannel의 나머지 메서드는 아직 없음(영속성/superstep에서 필요해지면 추가).

## 다음 벽
두 노드가 같은 키에 쓰면 LastValue가 거부한다 → **V3: 리듀서 채널**(`BinaryOperatorAggregate`)로 "이어붙이기/더하기" 같은 병합을 허용. (V1에서 LLM 붙일 때 본 "수동 메시지 append" 문제의 진짜 해법)
