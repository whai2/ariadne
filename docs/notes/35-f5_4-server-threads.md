# F5.4 — 서버가 대화 상태를 소유한다

F5.3은 SQLite 저장·복원을 제공했지만 Studio에서는 브라우저가 체크포인트를 다시 보내야 했다. F5.4는 이 기능을 서버 요청 흐름에 연결한다. 브라우저는 새 메시지나 승인 결정만 보내며, 서버는 thread ID로 기존 상태를 찾는다.

## 요청 계약

| 요청 | 본문 | 결과 |
|---|---|---|
| `POST /api/threads` | `{ "agentId": "mcp" }` | 201, 빈 대화 |
| `GET /api/threads/:id` | 없음 | 대화 정보, 전체 messages, pending, state |
| `POST /api/threads/:id/messages` | `{ "message": "메모 저장해줘" }` | 실행 결과와 저장된 thread |
| 같은 메시지 API | `{ "decision": "allow" }` 또는 `deny` | 승인 재개 결과 |

message는 비어 있지 않은 문자열이며 decision과 동시에 받을 수 없다. 클라이언트가 messages 배열, checkpoint, 에이전트 변경값을 전달하면 400이다. 없는 thread나 agent는 404다. 기존 `/api/agents/chat`은 제거했다.

응답은 기존 스텝 관찰과 기억 주입 배너를 위해 `steps`, 이번 실행에서 생성한 `messages`, `pending`, 선택적인 `injected`를 유지한다. 추가된 `thread`에는 서버에 저장된 전체 대화 상태가 들어 있다. 화면은 이 값을 기준으로 갱신한다.

## 서버 구조

`controllers/threads.ts`는 JSON 검증만 한다. `sessions.ts`는 thread를 조회하고 요청이 현재 대기 상태에 맞는지 검사한다. `services/agents.ts`의 runTurn은 그래프 구성, 기억 주입, 실행, 에피소드 기록을 담당한다.

실제 실행은 F5.3의 runWithCheckpoint를 사용한다. Studio는 stream을 감싸 스텝을 관찰하고 원본 이벤트를 그대로 래퍼에 전달한다. 이를 위해 래퍼의 graph 인자는 CompiledGraph 전체에서 실제 사용하는 stream 계약으로 좁혔다. core에는 변경이 없다.

`threads(id, agent, created_at)`를 기존 memory DB에 추가했다. 체크포인트가 없는 빈 대화도 존재할 수 있으므로 소유 에이전트를 체크포인트 안에 숨기지 않았다. 이 테이블 덕분에 서버 재시작 후에도 어떤 그래프를 구성할지 알 수 있다. 생성·조회는 MemoryStore의 createThread/getThread가 맡는다.

## 승인 재개

GET 요청은 저장된 메시지에서 pendingToolCalls를 계산한다. 모델이나 툴을 호출하지 않는다. 승인 대기 중 새 메시지는 거절하고, 대기 호출이 없을 때 도착한 승인도 거절한다. 연결 해제로 대기 중인 툴을 사용할 수 없거나 승인 정책이 제거됐으면 실행 전에 오류를 반환한다.

승인·거부를 받으면 해당 에이전트의 정책에 이번 결정만 주입한다. 저장된 상태를 복원한 그래프는 START에서 tools로 진입한다. 이후에 새로 발생한 툴 호출은 다시 기존 승인 정책을 따른다. 예산 채널은 첫 실행에 초기값에서 1을 뺀 값을 입력하고 이후 실행에는 -1만 입력한다.

## 브라우저 복구

localStorage에는 버전이 붙은 키로 선택한 에이전트 ID와 에이전트별 마지막 thread ID만 저장한다. 화면이 열리면 그래프, 기억, thread를 조회한다. thread 응답에서 메시지·승인 버튼·예산을 복구한다.

화면 전환 후 도착한 비동기 응답은 버전 검사를 통해 무시한다. 복구 실패를 빈 대화로 오인해 자동 전송하지 않도록 입력을 막고 오류를 표시한다. 요청 응답이 유실되면 자동 재전송하지 않고 thread를 다시 조회한다. 새 대화 버튼은 새로운 ID를 만들며 과거 대화를 삭제하지 않는다.

## 검증

가짜 모델과 기록용 툴을 주입한 HTTP 테스트로 다음을 확인한다.

- DB를 닫고 새 서버를 구성한 뒤 승인·거부 재개, 이력 중복 없음, 예산 유지.
- HTTP 서버 프로세스를 SIGKILL한 뒤 같은 DB로 다시 띄워 thread 조회와 승인 재개.
- 요청 형태 검증, 없는 ID, 대기 상태와 맞지 않는 승인, 상태 위조 요청 거절.
- 모델 오류 후 기존 체크포인트 유지와 대화 간 격리.
- 기존 DB에 threads를 추가해도 체크포인트 유지.

실제 브라우저에서는 테스트 서버로 메시지 전송 → 승인 대기 → 새로고침 → 승인 실행 → 다시 새로고침을 확인했다. 승인 버튼은 대기 상태에서 복구되고 완료 후에는 나타나지 않으며 예산은 4에서 3으로 이어진다. 새 대화는 빈 상태로 시작한다. 기존 MCP·실제 모델 통합 테스트는 thread API로 옮겨 기존 기능을 검증한다.

최종 검증: `bun run verify`에서 400 pass / 3 skip / 0 fail. 타입 검사와 Biome, Studio 프로덕션 빌드도 통과했다. 건너뛴 3개는 별도 API 키가 필요한 모델 테스트다.

## 현재 범위

실제 서버는 `.ariadne/memory.db` 파일을 사용한다. createStudio에 저장소를 생략하면 임시 DB를 사용하고 studio.close로 닫는다. 이 모드는 서버 재시작 시 유지되지 않으며 장기 기억 기록도 생략한다.

같은 thread는 순서대로 실행해야 한다. 여러 탭이나 요청의 동시 실행 제어, 인증·멀티유저, 요청 멱등성은 구현하지 않았다. 외부 툴 실행 후 체크포인트 저장 전에 죽는 경우에도 exactly-once를 보장하지 않는다.

화면은 에이전트별 마지막 대화 하나만 선택해 복구한다. 대화 목록·이름 변경·삭제는 없다. 스텝과 이번 턴의 기억 주입 배너는 새로고침 후 복구하지 않는다. 장기 기억은 기존대로 에이전트 단위로 공유한다. thread별 run 계층과 영속 트레이스는 이후 관측 단계에서 다룬다.

참고한 Python 원본은 `libs/langgraph/langgraph/pregel/main.py`의 thread_id를 통한 상태 조회와 `libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/__init__.py`의 thread별 조회 구조다. HTTP thread 메타데이터와 라우팅은 Studio의 계층에 맞춰 구성했다.
