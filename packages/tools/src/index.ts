// @ariadne/tools — 툴 링의 공개 배럴.
//
// 두 층이다:
//   tool.ts      **정의** — zod 하나로 "검증용 스키마"와 "모델이 볼 선언"을 같이 얻는다
//   toolNode.ts  **실행** — 그래프 노드. 병렬 실행 + 호출 id당 결과 하나 + 에러 정책
//
// **이 링은 `@ariadne/model`을 모른다.** SDK도 없다. `toolSpecs()`가 내놓는 객체가
// 모델 링의 `ToolSpec`과 구조적으로 같을 뿐이고, 둘을 실제로 엮는 건 apps/studio다.
// 의존 간선을 안 늘린 게 이 단계의 부수 성과다.
//
// zod는 이 저장소의 **첫 스키마 라이브러리이자 첫 비-SDK 런타임 의존**이다.
// core는 여전히 런타임 의존성 0이다 — 스키마는 채널에 사는 게 아니라 프로바이더용 산출물이라
// 링에 있는 게 맞다.

export { add, DEMO_TOOLS, multiply, now } from "./demo";
export { MissingToolMessageError } from "./errors";
export type { AnyTool, JSONSchemaObject, Tool, ToolContext, ToolSpecShape } from "./tool";
export { defineTool, toJsonSchema, toolSpecs } from "./tool";
export { coerceContent, lastToolCalls, toolNode, toolsCondition } from "./toolNode";
