// 데모용 툴 셋. **표준 라이브러리가 아니다** — 예제와 스튜디오가 뭔가를 부를 게 필요해서 있다.
//
// `calc(expression)` 대신 산술 툴 둘로 쪼갠 이유가 셋이다:
//   1. `eval`/`new Function` 문제를 통째로 피한다.
//   2. "3+4와 5×6" 한 문장이 **한 턴에 호출 둘**을 내서, 병렬 실행과 id 불변식을 한 번에 보여준다.
//   3. `z.number()`라 모델이 `{"a": "3"}`(문자열)을 보내는 검증 실패 데모가 자연스럽다.
// `now()`는 **인자 없는 툴**(= required 키가 아예 없는 스키마) 케이스다.

import { z } from "zod";
import { type AnyTool, defineTool } from "./tool";

export const add = defineTool({
  name: "add",
  description: "두 수를 더한다",
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: ({ a, b }) => a + b,
});

export const multiply = defineTool({
  name: "multiply",
  description: "두 수를 곱한다",
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: ({ a, b }) => a * b,
});

export const now = defineTool({
  name: "now",
  description: "현재 시각을 ISO 8601 문자열로 돌려준다",
  schema: z.object({}),
  execute: () => new Date().toISOString(),
});

/** 타입을 지운 목록. 여기 담기는 것 자체가 `Tool<구체타입> → AnyTool` 대입 검사다. */
export const DEMO_TOOLS: AnyTool[] = [add, multiply, now];
