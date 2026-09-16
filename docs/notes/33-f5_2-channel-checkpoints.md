# F5.2 — 채널 상태의 저장과 복원

F5.1에서 대화 이력만 다시 전달하면 `plan`과 `budget` 같은 다른 상태가 사라짐을 확인했다. F5.2는 채널마다 값을 내놓고 복원하는 계약을 추가했다. 이 문서는 F5.3 작업 중 기존 구현을 기준으로 보완했다.

## 복원과 입력은 서로 다른 연산이다

`checkpoint()`는 리듀서 적용이 끝난 값을 반환한다. `fromCheckpoint(value)`는 같은 설정을 가진 새 채널에 그 값을 직접 넣는다. 이후에 들어온 입력만 `applyWrites`를 통해 리듀서를 거친다.

예를 들어 저장된 budget이 5이고 이번 입력이 -1이면 결과는 4다. 저장된 5를 입력으로 다시 전달하면 합산 리듀서는 10을 만든다. 따라서 재개 요청은 전체 상태가 아니라 이번 변화만 전달해야 한다.

LastValue, BinaryOperatorAggregate, EphemeralValue, Topic, NamedBarrierValue의 다섯 구현이 이 계약을 제공한다. 배리어의 Set은 배열로 내놓고 복원할 때 다시 Set으로 만든다. 빈 채널은 MISSING을 반환해 스냅샷에서 제외한다. 다만 JSON은 값이 undefined인 키도 생략하므로 그 구분까지 디스크에 보존하지는 않는다.

## 어디서 다시 시작하는가

`CompiledGraph.stream(input, { checkpoint })`는 스키마의 채널 팩토리로 채널을 만든 뒤 저장값을 복원하고 START에서 실행한다. 제어 채널과 미완료 태스크는 저장하지 않는다. 따라서 임의의 중간 스텝에서 이어 실행하는 API가 아니다.

승인 대기는 에이전트가 정상 종료한 정지점이다. 새 run의 진입 라우터는 복원된 메시지에서 답하지 않은 툴 호출을 찾아 tools로 진입한다. 실행 위치를 복원하지 않아도 이 경로가 성립한다.

## 검증과 한계

채널 왕복 테스트와 agent의 resume 테스트가 plan·budget 복원, 리듀서 우회, 입력 중복의 결과를 확인한다. core의 의존성 및 계층 경계는 유지된다.

스냅샷은 스텝 이벤트로만 제공된다. 영속화할 키는 스키마에 선언해야 한다. 스키마 변경 대응, 임의 위치 재개, 저장소는 이 단계에 포함하지 않는다. F5.3이 정지점 저장과 thread별 조회를 맡는다.

참고한 Python 구조: `libs/langgraph/langgraph/channels/base.py`, `last_value.py`, `binop.py`의 checkpoint/from_checkpoint 계약. 코드는 우리 채널 인터페이스에 맞춰 구성했다.
