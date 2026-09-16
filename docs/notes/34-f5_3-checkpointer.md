# F5.3 — thread별 실행 상태를 SQLite에 저장한다

이제 프로세스가 종료되어도 DB 경로와 thread ID가 같으면 에이전트 상태를 복원할 수 있다. 호출자는 대화 이력이나 plan·budget을 다시 전달하지 않는다. 저장소는 `@ariadne/memory`, 실행과 저장의 연결은 `@ariadne/agent`에 있으며 core는 바뀌지 않는다.

## 사용법

```ts
import { MemoryStore } from "@ariadne/memory";
import { runWithCheckpoint } from "@ariadne/agent";

const store = MemoryStore.open("./data/memory.sqlite");
try {
  // graph는 영속화할 키가 스키마에 선언된 컴파일 그래프다.
  const state = await runWithCheckpoint(graph, threadId, inputDelta, store);
} finally {
  store.close();
}
```

첫 실행은 초기 입력을 전달한다. 이후 실행은 새 메시지나 budget 변화량만 전달한다. 승인 재개는 승인 정책을 설정한 그래프에 `{}`를 전달한다. 과거 이력을 다시 보내면 누적 채널에서 중복될 수 있다. 실행 가능한 예제는 `bun run --filter '@ariadne/agent' example:persistent`다.

## 저장 구조와 조회 계약

`checkpoints`의 기본키는 `(thread_id, checkpoint_ns, checkpoint_id)`다. namespace는 현재 빈 문자열로 고정한다. ID는 thread 안에서 1부터 증가하며 시계의 역행과 관계없이 최신 행을 찾을 수 있다. parent_checkpoint_id는 직전 행을 가리킨다. step은 run마다 0부터 다시 시작하고 created_at은 관찰용 시각이다.

channels_json은 채널 상태만 담는다. 모델 입력용 기억을 고르는 facts 조회와는 별개다. 기본키 인덱스 외에 추가 인덱스는 만들지 않았다. 기존 DB에는 CREATE TABLE IF NOT EXISTS로 테이블이 추가된다.

| API | 역할 |
|---|---|
| `putCheckpoint(threadId, snapshot)` | 호출자가 보장한 정지점 하나 저장 |
| `putCheckpoints(threadId, snapshots)` | 마지막이 정지점인 스텝 묶음을 원자적으로 저장 |
| `getLatest(threadId)` | 최신 정지점 반환. 없으면 undefined |
| `list(threadId, limit = 100)` | 최신순 관찰용 스텝 이력 |
| `runWithCheckpoint(graph, threadId, input, store)` | 최신 상태 복원 → 실행 → 저장 → 최종 상태 반환 |

## 왜 실행이 끝난 뒤 저장하는가

F5.2 스냅샷에는 제어 채널이 없다. 중간 스텝을 바로 저장한 뒤 프로세스가 죽으면, 다음 실행이 그 행을 완전한 복원 지점으로 오인한다. 원래 남아 있던 태스크를 알 수 없기 때문이다.

래퍼는 각 스텝을 즉시 JSON 복사해 메모리에 모은다. stream을 끝까지 소비해 정상 종료를 확인한 뒤 한 트랜잭션으로 모두 저장한다. 마지막 행만 재개 가능한 정지점이고 앞선 행들은 관찰용이다. 실행 오류나 직렬화 오류는 아무것도 저장하지 않는다. 배치 삽입 중 오류가 발생하면 앞선 삽입도 롤백한다. 모델이나 툴을 기다리는 동안에는 DB 트랜잭션을 열지 않는다.

이 선택으로 실행 중 스냅샷만큼 메모리를 사용한다. 실패한 실행의 중간 이력도 남지 않는다. 그것을 수집하는 관측 기능은 F6의 영역이다.

## 검증

- 승인 대기를 저장한 자식 프로세스를 SIGKILL한 뒤 새 프로세스에서 allow/deny 재개. 전달값은 DB 경로, thread ID, 승인 결정뿐이다.
- plan·budget 보존, 이력 중복 없음, 승인 시 툴 실행 후 모델 호출, 거부 시 툴 실행 없음.
- 완료 후 다시 실행해도 이미 처리한 툴 호출을 재실행하지 않음.
- thread 격리, 증가하는 ID와 부모 연결, 파일 재개방, JSON 복사, 실패한 run의 정지점 보존, 배치 롤백.

`bun run verify` 통과: 394 pass / 3 skip / 0 fail. 타입 검사와 Biome도 통과했다. 건너뛴 3개는 별도 API 키가 필요한 외부 모델 테스트이며, 실행 가능한 CLI·MCP·Studio 통합 테스트는 통과했다.

## 보장하지 않는 것

같은 thread의 실행은 호출자가 직렬화해야 한다. DB 트랜잭션만으로 동시에 실행한 두 run의 상태 충돌을 막지는 못한다. 외부 툴의 효과와 SQLite 저장도 하나의 트랜잭션이 아니다. 툴 실행 후 저장 전에 죽으면 재개 시 효과가 반복될 수 있으며 exactly-once 실행을 보장하지 않는다.

JSON으로 표현 가능한 상태만 지원한다. undefined는 생략되고 BigInt·순환 참조는 오류가 난다. 영속화할 키는 스키마에 선언해야 한다. 0스텝 그래프는 core가 스냅샷을 제공하지 않아 래퍼가 명시적으로 거부한다. createAgent는 최소 한 스텝을 실행한다.

중간 행을 이용한 타임트래블, namespace API, GC, 스키마 버저닝, HTTP thread API는 추가하지 않았다. 다음 단계 F5.4에서 Studio 서버가 thread를 소유하고 생성·조회·메시지 전송을 연결한다.

참고한 Python 원본: `libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/__init__.py`의 setup/get_tuple/put. thread와 namespace로 조회 범위를 묶는 개념을 참고했다. 우리의 ID는 정수이고, pending writes 없이 정상 종료한 run만 저장한다.
