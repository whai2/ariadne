# V7 · Command + compile 정합 — 스케줄링이 채널 위로 올라오다

## 무엇이 바뀌었나 (새로 도는 건 거의 없다)

V7은 **새 기능을 거의 안 늘리고, 이미 되던 걸 전부 같은 메커니즘으로 다시 표현하는** 단계다.
V1~V6 예제가 하나도 안 바뀐 채 그대로 돈다 — 그게 이 단계의 검증이다.

바뀐 건 딱 하나: **"다음에 누굴 실행할까"를 엔진이 계산하지 않고, 정점이 채널을 구독한다.**

```
V6:  엔진이 아웃엣지·라우터·Send를 종류별로 훑어 활성 태스크를 만든다
V7:  누구든 채널에 쓴다 → 그 채널을 구독한 정점이 깨어난다 (엔진은 엣지가 뭔지 모른다)
```

## 제어 흐름 네 종류가 한 연산으로 수렴

전부 [`controlWrites`](../../packages/core/src/graph/stateGraph.ts) 한 함수로 낮춰진다.

| 선언 | 낮춘 결과 |
|---|---|
| `addEdge("a","b")` | a에 writer 추가 → `branch:to:b`에 쓴다 |
| `addConditionalEdges("a", router)` | a에 writer 추가 → router 결과를 `branch:to:*`에 쓴다 |
| `Send(node, arg)` | `TASKS` 채널(Topic)에 쌓는다 → 다음 스텝 PUSH 태스크 |
| `Command({goto})` | 위 두 개와 **완전히 같은 쓰기** |
| `→ END` | **아무 데도 안 쓴다** (아무도 안 깨어나면 그게 종료) |

그래서 `Command`가 엔진엔 새 개념이 아니다. "노드가 반환값으로 낼 수 있는 goto"일 뿐,
낮추면 조건부 엣지와 글자 그대로 같은 채널 쓰기다.

## 새 채널 3종 — 수명과 가용성이라는 새 차원

지금까지 채널은 "값을 어떻게 합치나"(덮어쓰기/리듀서)만 달랐다. V7의 셋은 **언제 값이 있나**가 다르다.

| 채널 | 언제 열리나 | 언제 닫히나 | 쓰임 |
|---|---|---|---|
| [`EphemeralValue`](../../packages/core/src/channels/ephemeralValue.ts) | 쓰이면 | **다음 스텝 경계에 자동 만료** | `branch:to:<노드>` 트리거 |
| [`NamedBarrierValue`](../../packages/core/src/channels/namedBarrier.ts) | **이름이 전부 모이면** | `consume()`(태스크가 실제로 돌았을 때) | `join:b+e:d` 배리어 |
| [`Topic`](../../packages/core/src/channels/topic.ts) | 값이 하나라도 있으면 | 다음 스텝 경계에 자동 만료 | `TASKS`(Send 대기열) |

만료 메커니즘이 재밌다. `update([])`가 **"이번 스텝엔 아무도 안 썼다"는 통지**로 재정의됐다
([`expireStale`](../../packages/core/src/pregel/algo.ts)). 상태 채널엔 no-op이고, 수명 1스텝인 채널만
스스로 비운다. 즉 **"트리거는 한 번만 발화한다"가 스케줄러 코드가 아니라 채널 정의에서 나온다.**

## 사라진 코드가 얻은 것

V6의 `dedupePullTasks`(같은 노드로 온 PULL을 하나로 접던 함수)가 **통째로 삭제**됐다.
b·c가 동시에 d를 깨워도 트리거 채널은 하나뿐이라 채널이 알아서 접는다.

그리고 지난 단계까지 못 하던 게 공짜로 풀렸다 — **비대칭 팬인**.
스케줄링이 채널 위로 올라오니 "기다림"이 스케줄러 옵션이 아니라 **채널 종류를 바꾸는 일**이 된다:

```ts
g.addEdge("b", "d"); g.addEdge("e", "d");  // EphemeralValue → 먼저 온 쪽이 깨움, d 2번
g.addEdge(["b", "e"], "d");                 // NamedBarrierValue → 다 모여야, d 1번
```

## 라우터가 보는 상태가 바뀌었다 (정확도 개선)

V6까지 라우터는 `stateNow` — **barrier 이후, 병렬 노드들의 쓰기까지 다 합쳐진** 상태를 봤다.
V7은 원본대로 **로컬 읽기**다: 스텝 시작 스냅샷에 *자기 노드의 쓰기만* 반영한 사본.

```
b의 라우터가 보는 log:  ["a", "b"]      ← 자기 쓰기는 보임
                       ["a","b","c"] ✗  ← 같은 스텝 c의 쓰기는 안 보임(BSP)
```

구현은 [`localRead`](../../packages/core/src/pregel/algo.ts) — 채널을 `copy()`해 자기 쓰기만 얹고 읽은 뒤 버린다.
이걸 위해 `BaseChannel`에 `copy()`와 `consume()`이 생겼다.

라우터의 **위치**도 바뀌었다: "barrier 뒤에 도는 플래너"에서 **"노드 자신의 writer"**로.
이게 정점 관점 쪽으로 한 발 간 지점이다 — 분기 결정이 전역 계산이 아니라 정점의 지역 행위가 됐다.

## PregelNode — 정점이 자기 초인종을 갖는다

```ts
interface PregelNode<S> {
  triggers: string[];   // 이 채널에 값이 있으면 나는 깨어난다  ← 정점의 inbox
  bound: BoundFn;       // (input: never) => unknown — 엔진은 반환값을 해석하지 않는다
  writers: Writer<S>[]; // bound 뒤에 도는 쓰기들 (상태 → 엣지 → join → 라우터 순)
}
```

노드는 여전히 채널 이름을 모른다(불변식 1). "부분 상태를 반환"할 뿐이고, 그걸 **어느 채널에
어떻게 흘릴지는 전부 writer가 안다.** 엣지를 하나 더 거는 것 = writer를 하나 더 붙이는 것.

## 폴더가 갈라졌다 (구조로 증명되는 불변식 3)

V7에서 "엔진 ↔ 사용자 API"의 경계가 코드로 뚜렷해져서, `src/`를 세 층으로 나눴다.

```
공용 어휘   constants · errors · send · channels/    ← 위를 모른다
   ↑
pregel/     algo · loop · node · types               ← graph/를 모른다
   ↑
graph/      stateGraph · command · types             ← compile()이 PregelSpec으로 낮춰 넘긴다
```

접점은 [`PregelSpec`](../../packages/core/src/pregel/types.ts) 하나뿐이다. 이걸 지키려고
`PregelNode.bound`의 반환 타입을 `unknown`으로 낮췄다 — 엔진이 `Command`를 알 필요가 없어지고,
"부분 상태냐 Command냐"는 graph/의 writer만 판별한다.

화살표가 한 방향이라 **"StateGraph는 순수 sugar"가 구조로 증명된다**: 엔진이 StateGraph를 못 보므로,
엔진만 남기고 다른 빌더를 얹어도 그대로 돈다. 이 경계는 주석이 아니라
[`architecture.test.ts`](../../packages/core/test/architecture.test.ts)가 지킨다(import를 스캔해 위반 시 실패).

## 08 분류 지도에서 켠 칸

- 들어오기 **[기다림]** — `NamedBarrierValue`로 진짜 join ✅ (마지막 남은 ❌ 칸)
- 채널 성질 **[수명]** — persist 말고 **1스텝짜리** 채널 ✅
- 데이터 흐름 **[읽기]** — `triggers`로 "특정 채널만 구독"이 처음 등장 ✅ (값 읽기는 아직 전체)

## 검증

- 회귀: V1~V6 테스트 **전부 무수정 통과**(단 하나, 비대칭 팬인 테스트는 기대값이 아니라 *의미*가
  바뀌어 다시 씀 — "한계"가 아니라 "개별 엣지의 정확한 의미"였다).
- [`v7_channels.test.ts`](../../packages/core/test/v7_channels.test.ts): 새 채널 3종의 수명·가용성.
- [`v7_command.test.ts`](../../packages/core/test/v7_command.test.ts): Command(update/goto/Send),
  compile이 낳은 채널 목록(`getChannelNames()`), 제어 채널 비노출, 라우터 로컬 읽기.
- [`staggered-fanin.test.ts`](../../packages/core/test/staggered-fanin.test.ts): 개별 엣지 2회 vs 배리어 1회.

`addNode<I>`가 생겨 V6 노트가 남긴 숙제도 정리됐다 — Send 워커가 `as unknown as` 없이 타입이 맞는다.

## 안 한 것 (정직)

- **`CONFIG_KEY_READ` / `CONFIG_KEY_SEND` 없음.** 원본은 노드가 Runnable이라 config로 읽기/쓰기
  클로저를 *주입*한다. 우리 writer는 엔진이 직접 호출하므로 `read`를 **인자로 넘긴다**. 개념은
  같고 배선만 다르다 — 지금 필요 없는 간접층이라 안 만들었다.
- **`PregelNode.channels` / `mapper` 없음.** 노드마다 다른 입력 스키마를 허용하려고 원본이 갖는
  필드인데, 우리는 그래프당 스키마 하나라 PULL은 항상 상태 전체를 읽는다. 필요해질 때 만든다.
- **START가 진짜 정점은 아니다.** 원본은 `START` 채널을 트리거로 삼는 PregelNode가 step -1에
  돈다. 우리는 그 한 스텝을 초기화에 접어넣었다(관찰되는 step 0은 그대로 첫 사용자 노드).
- **버전(versions_seen) 없음.** 원본은 채널 버전으로 "이미 본 값인가"를 판정한다. 우리 트리거는
  전부 1스텝 수명이라 `isAvailable()`만으로 충분하다. 영속성/재개가 들어오면 그때 필요해진다.
- **`trigger_to_nodes` 역인덱스 생략.** 스텝마다 전 노드의 트리거를 훑는다(노드 수가 작아 무의미).
  정확성은 같고 상수배만 다르다.

## 벽 → 다음 (V8)

구조는 원본과 정합됐다. 남은 건 **실제로 쓰이는 모양** — 메시지 리스트가 누적되는 챗봇형 그래프.
`MessagesState` + `addMessages` 리듀서로 마무리한다.

## 참조

- langgraph: `pregel/_read.py`(PregelNode·ChannelRead), `pregel/_write.py`(ChannelWrite),
  `pregel/_algo.py`(apply_writes·prepare_next_tasks·local_read·_triggers),
  `channels/ephemeral_value.py`, `channels/named_barrier_value.py`, `channels/topic.py`,
  `graph/state.py:1509,1531,1551,1760`(attach_node/attach_edge/attach_branch/_control_branch),
  `types.py`(Command).
- 우리: [`pregel/`](../../packages/core/src/pregel/)(algo·loop·node·types),
  [`graph/`](../../packages/core/src/graph/)(stateGraph·command·types),
  [`08-control-flow-taxonomy.md`](08-control-flow-taxonomy.md).
