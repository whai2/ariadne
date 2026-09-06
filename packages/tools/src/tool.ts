// 툴 정의 — **두 세계가 만나는 객체**를 만든다 (F2.2).
//
//   schema (zod)         우리가 인자를 검증할 때 쓴다      → 타입도 여기서 나온다
//   spec   (JSON Schema) 모델이 보는 것                  → 와이어로 나간다
//
// 하나를 적으면 둘 다 나온다는 게 zod를 들인 이유다. F2.1의 예제는 JSON Schema를 손으로
// 쓰고 실행 함수의 TS 타입을 따로 적었는데, 둘이 **드리프트해도 아무도 안 잡아줬다.**
//
// langgraph 대응: langchain_core tools/{convert,structured}.py 의 @tool / StructuredTool
// (파이썬은 시그니처+독스트링에서 pydantic 스키마를 만들고, 우린 zod를 직접 받는다).

import { z } from "zod";

/**
 * 툴 실행 문맥. 지금은 **호출 id 하나**뿐이다.
 *
 * 왜 필요한가: `Command`를 돌려주는 툴은 자기 결과 메시지를 **직접** 만들어야 하는데,
 * 그러려면 자기가 어느 호출인지 알아야 한다(langgraph의 `InjectedToolCallId`가 푸는 문제).
 * 그래프 상태 주입은 여기 없다 — 그건 인자 강제 제거까지 딸려오는 큰 주제라 미룬다.
 */
export interface ToolContext {
  toolCallId: string;
}

/**
 * JSON Schema의 object 스키마. `@ariadne/model`의 `ToolSpec.parameters`와 **모양이 같다** —
 * 그런데 import는 안 한다(아래 `ToolSpecShape` 주석 참조).
 */
export interface JSONSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * 모델에게 보여줄 선언.
 *
 * **`@ariadne/model`의 `ToolSpec`과 구조적으로 같지만 import하지 않는다.** 이 링은
 * 모델 링을 몰라야 한다 — 툴은 "무엇을 할 수 있는가"이지 "누가 부르는가"가 아니다.
 * 둘을 잇는 건 TypeScript의 구조적 타이핑이고, 그게 실제로 맞는지 기계적으로 검사하는
 * 자리는 **둘 다 의존하는 `apps/studio`의 `tsc`**다.
 */
export interface ToolSpecShape {
  name: string;
  description: string;
  parameters: JSONSchemaObject;
}

/**
 * 툴 하나.
 *
 * `execute`가 **메서드 문법**인 건 의도다 — 화살표 프로퍼티로 쓰면 파라미터가 반공변이라
 * `Tool<{a: number}>`를 `AnyTool[]`에 못 넣는다. 메서드 파라미터는 이변이라 들어간다.
 */
export interface Tool<A = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  /** 인자 검증용. 이걸로 `spec`을 뽑았다. */
  readonly schema: z.ZodObject;
  /** 모델이 보는 선언. `defineTool`이 만들 때 한 번 계산해 둔다. */
  readonly spec: ToolSpecShape;
  /**
   * 실제 하는 일. 반환은 무엇이든 된다 — 문자열이면 그대로, 아니면 JSON으로 직렬화돼
   * 결과 메시지가 되고, `Command`면 상태·제어흐름 갱신이 된다.
   * **예외를 잡지 마라.** 툴 본문의 예외는 우리 버그라 전파돼야 한다(→ toolNode).
   */
  execute(args: A, ctx: ToolContext): unknown;
}

/** 인자 타입을 지운 툴. 레지스트리에 담을 때 쓴다. */
export type AnyTool = Tool<Record<string, unknown>>;

/**
 * zod 스키마 → 모델에게 보낼 JSON Schema. **순수 함수.**
 *
 * 후처리가 딱 하나 있다: **`$schema`를 뗀다.** zod는 이걸 항상 붙이고 끄는 옵션이 없는데,
 * 두 프로바이더 어디에도 쓸모가 없는 메타 키워드다.
 *
 * **`io: "input"`인 게 중요하다.** 기본값 `"output"`으로 뽑으면 `.default()`가 붙은 필드가
 * `required`에 들어간다 — 기본값이 있는데도 **모델에게 반드시 보내라고 말하는** 셈이다.
 * 툴 인자는 모델이 만드는 **입력**이므로 입력 스키마가 맞다.
 * (대가: `additionalProperties: false`가 안 붙는다. 어차피 zod로 다시 검증하므로 손해가 없고,
 * 억지로 붙이면 passthrough 스키마에 대해 거짓말이 된다.)
 *
 * 표현할 수 없는 타입(`z.date()` 등)이면 zod가 **여기서 던진다.** 늦게 터뜨릴 이유가 없다 —
 * 이건 환경 문제가 아니라 툴 저자의 버그다.
 */
export function toJsonSchema(schema: z.ZodObject): JSONSchemaObject {
  const { $schema: _dropped, ...rest } = z.toJSONSchema(schema, { io: "input" });
  return rest as JSONSchemaObject;
}

/**
 * 툴을 정의한다.
 *
 * ```ts
 * const add = defineTool({
 *   name: "add",
 *   description: "두 수를 더한다",
 *   schema: z.object({ a: z.number(), b: z.number() }),
 *   execute: ({ a, b }) => a + b,      // ← a·b가 number로 추론된다
 * });
 * ```
 */
export function defineTool<T extends z.ZodObject>(def: {
  name: string;
  description: string;
  schema: T;
  execute(args: z.infer<T>, ctx: ToolContext): unknown;
}): Tool<z.infer<T>> {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    // 즉시 계산한다 — 표현 불가 타입이면 여기서 터져 툴 저자가 바로 안다.
    spec: {
      name: def.name,
      description: def.description,
      parameters: toJsonSchema(def.schema),
    },
    execute: def.execute,
  };
}

/**
 * 모델 호출에 넘길 선언 목록.
 *
 * ```ts
 * await model.invoke(messages, { tools: toolSpecs(TOOLS) });
 * ```
 */
export function toolSpecs(tools: readonly AnyTool[]): ToolSpecShape[] {
  return tools.map((t) => t.spec);
}
