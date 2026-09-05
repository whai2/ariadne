# V6 · Send 팬아웃 (map-reduce)

## 무엇이 바뀌었나
`Send(node, arg)`가 등장. 라우터가 **리스트 항목마다 Send를 반환**하면, 각 Send가 다음 tick의 **동적 병렬 태스크**가 된다 → 개수를 모르는 리스트를 **런타임 개수만큼** 병렬 처리하고 리듀서로 취합(map-reduce).

```ts
g.addConditionalEdges(START, (s) => s.items.map((i) => new Send("square", i)));
// items가 3개면 square 태스크 3개, 100개면 100개 — 코드엔 개수가 없다(.map)
```

## node vs task 구분이 여기서 처음 생김
지금까지는 **노드 이름**만으로 실행 단위를 표현했다(`active: Set<string>`). 노드=태스크 1:1이라 충분했다. V6은 **노드 1개(`square`)가 payload 다른 태스크 N개**를 낳으므로, 이름만으론 구분이 안 된다 → **Task 자료구조**가 필요해진다.

- **노드** = 정의(빌드타임에 `addNode`). 정적, 1개.
- **태스크** = 실행 인스턴스(런타임). `type Task = { node; arg? }`.
  - **PULL**(`arg` 없음): 엣지/라우터가 깨운 노드. 공유 스냅샷을 입력으로.
  - **PUSH**(`arg` 있음): Send가 만든 태스크. 자기 payload를 입력으로.

## 내부 구현
- [`send.ts`](../../packages/core/src/send.ts): `Send { node, arg }`.
- [`types.ts`](../../packages/core/src/types.ts): `RouteTarget = string | Send`. Router 반환에 Send 허용.
- [`pregel.ts`](../../packages/core/src/pregel.ts):
  - `nextTargets` → **`nextTasks`**: 정적 엣지·라우터 노드명 → PULL, Send → PUSH. `Task[]` 반환.
  - `active`: `Set<string>` → **`Task[]`**. 실행 시 `node(task.arg ? payload : snapshot)`.
  - `dedupePullTasks`: PULL은 노드별 1개(팬인), **PUSH는 모두 유지**(payload가 다르니 별개 실행).
  - 순서: 노드 이름 안정 정렬 → 같은 노드의 PUSH들은 emit 순서 유지(리듀서 fold 순서 고정).

```
V5:  active = Set<노드이름>        → 이름만
V6:  active = Task[]  (PULL | PUSH) → 노드 + (PUSH면 payload)
```

## 08 분류 지도에서 켠 칸
- 나가기 **[동적]** — 개수를 런타임 데이터가 정함 ✅
- 엣지 **[페이로드]** — Send가 제어뿐 아니라 데이터를 실음(메시지 패싱) ✅

## 검증 (test/mapreduce.test.ts)
조건부 진입 map-reduce(square) · 동적 개수(길이 5/1/0) · **per-item payload**(각 태스크가 자기 항목 받음) · dispatch→worker×N→gather(map 후 팬인 reduce) · Send 모르는 노드 에러. (5 케이스)

## 미룬 것 (정직 — ROADMAP이 예고한 "임시방편")
- **TASKS/Topic 채널 백킹 생략.** 원본은 Send를 예약 `TASKS`(Topic) 채널에 쓰고 다음 tick에 PUSH로 읽는다(영속성·통일성 때문). 우리는 영속성이 범위 밖이라 `active: Task[]`가 그 버퍼 역할을 직접 한다. 채널 indirection은 V7 정합에서.
- **NodeFn 타입이 PUSH payload를 표현 못 함.** worker는 `(state: S)` 시그니처인데 실제론 payload를 받아 테스트에서 `as unknown as` 캐스팅이 필요하다. V7의 mapper/Command가 정리.
- **노드가 직접 Send 반환(Command)**은 미구현. 지금은 라우터(조건부 엣지)만 Send를 낸다.

## 벽 → 다음 (V7)
노드 반환/제어흐름이 임시방편(payload 타입 캐스팅, 채널 없이 Task 버퍼)이라 원본 구조와 어긋난다. **V7에서 `Command`(goto+update)로 통일**하고 compile을 `PregelNode`/`ChannelWrite`/`NamedBarrierValue`로 정합시켜 V1~V6 예제가 원본 구조에서 그대로 돌게 한다.

## 참조
- langgraph: `types.py`(Send·PregelExecutableTask), `pregel/_algo.py`(prepare_next_tasks의 PUSH/PULL), `channels/topic.py`(TASKS 백킹).
- 우리: [`send.ts`](../../packages/core/src/send.ts), [`pregel.ts`](../../packages/core/src/pregel.ts)(nextTasks/Task/dedupePullTasks), [`08-control-flow-taxonomy.md`](08-control-flow-taxonomy.md).
