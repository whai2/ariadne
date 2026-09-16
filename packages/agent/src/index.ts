// @ariadne/agent — 에이전트 링의 공개 배럴.
//
// model+tools 자율 루프 하나. F3의 논지는 **에이전트 = core 위의 특수한 그래프**라,
// 이 링에 새 실행기가 없다 — `createAgent`는 F2가 손으로 쓰던 ReAct 네 줄을 접고,
// 컴파일된 그래프를 돌려준다(그래서 스튜디오 관찰이 그대로 붙는다).
//
// **이 링만 model·tools를 둘 다 안다**(F2.2에서 둘을 서로 모르게 뒀던 것의 첫 예외).
// 그 접점 — tools의 `toolSpecs()`를 model의 `invoke({tools})`에 넘기는 자리 — 이 이제
// 이 링의 tsc로 검사된다. core는 여전히 런타임 의존성 0이고, 이 링은 그 위에 얹힐 뿐이다.

export type { AgentConfig } from "./agent";
export { createAgent } from "./agent";
// 승인 게이트. pendingToolCalls는 run 종료 후 승인 대기 여부를 알려준다.
// F5.3의 runWithCheckpoint는 저장된 상태를 복원해 같은 그래프를 다시 실행한다.
export type { Approval, ApprovalPolicy } from "./approval";
export { askAlways, askFor, pendingToolCalls } from "./approval";
export type { CheckpointStore } from "./checkpoint";
export { runWithCheckpoint } from "./checkpoint";
export { ApprovalWithoutToolsError, ModelCannotUseToolsError } from "./errors";
