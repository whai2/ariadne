# S14 · 누적 상태 덤프를 실행 트레이스로 바꾼다

F6.2까지 span 트리는 메모리에만 있었고 Studio는 별도의 `StepUpdate[]`를 응답에 실었다. 화면은
각 superstep 뒤의 **전체 messages 상태**를 반복해 그렸다. 파일 세 개를 읽는 짧은 실행도 같은
이력이 일곱 번 누적돼, 사용자는 "이번 노드가 무엇을 했나"를 찾을 수 없었다.

이번 단계는 관찰의 주어를 상태에서 실행으로 바꾼다.

## 저장 경계

`@ariadne/observability`에 `TraceStore`를 추가했다. Bun 내장 SQLite를 사용하므로 런타임 외부
의존성 0을 유지한다. 완료된 run의 span 목록을 한 행에 원자적으로 저장한다. root의 thread ID,
시작·종료 시각, 성공·실패를 조회 컬럼으로 두고 span 전체는 JSON으로 보존한다.

체크포인트와 trace는 저장 정책이 다르다. 체크포인트는 정상 정지점만 공개하지만 trace는 실패가
가장 중요한 자료라 예외가 던져진 run도 저장한다. 실제 Studio 서버도 `memory.db`와 `traces.db`를
나눠 연다. 상태 복원 실패가 관측 기록의 스키마와 얽히지 않는다.

## 실행 래퍼의 조합

기존 `traceRun()`과 `runWithCheckpoint()`는 둘 다 stream을 끝까지 소비하므로 서로 감쌀 수 없었다.
`tracedGraph(build, options)`를 새로 만들고 `traceRun()`도 그 위에서 구현했다. `tracedGraph`는
관측 가능한 graph 모양만 반환하고 소비하지 않는다. Studio에서는 그 graph를 기존 체크포인터가
소비한다. 따라서 한 번의 실행으로 span 관측과 체크포인트 저장이 함께 일어나며 중복 실행이 없다.

`buildAgentGraph`는 run 전용 `GraphTrace`를 `createAgent`에 전달한다. 그래서 superstep/node뿐 아니라
실제 model/tool 호출도 같은 부모 트리에 붙는다. 완료된 collector는 성공·실패 양쪽의 `finally`에서
저장된다.

## HTTP와 화면

`GET /api/threads/:id/traces`는 최신 run부터 최대 100개를 반환한다. 존재하지 않는 thread는 404이며
다른 thread의 기록은 섞이지 않는다. 새로고침과 서버 재시작은 조회만 할 뿐 모델을 다시 실행하지
않는다.

화면은 다음 순서로 좁혀 읽는다.

1. run 선택 — 시각과 성공/실패
2. span 타임라인 — superstep/node/model/tool의 상대 위치와 소요 시간
3. 입력·출력 token 합계와 superstep 수
4. superstep 선택 — 해당 node를 위 그래프에서 강조
5. node의 `ariadne.channel.writes` — 전체 상태가 아니라 **그 노드가 새로 쓴 값만** 표시

같은 정보를 두 번 보내던 `AgentReply.steps`는 제거했다. 턴 응답은 새 메시지·승인 상태·thread만
주고, 관측 기록은 별도 traces 자원에서 읽는다. 실패한 HTTP 요청도 화면이 traces를 다시 읽어
실패 run을 발견한다.

## 검증

- TraceStore 성공·실패 round-trip, thread 격리, 파일 재개, 실행 중/mixed trace 거부.
- 승인 대기와 재개가 같은 thread의 별도 run 두 개이며 재개 trace의 첫 node가 tools.
- 모델 실패가 500을 반환해도 error trace가 남고 체크포인트는 바뀌지 않음.
- HTTP 서버 SIGKILL 후 같은 memory/trace DB로 대화와 두 run을 함께 복원.
- 실제 Claude Code + 데모 MCP로 `model → tools → model` 3 superstep을 실행해 타임라인,
  token 합계, Step 1의 ToolMessage write, 그래프 tools 강조를 브라우저에서 확인.

타임트래블 재실행, 외부 전송, 샘플링·보존 기한은 범위 밖이다.
