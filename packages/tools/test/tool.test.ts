import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type AnyTool, add, defineTool, now, toJsonSchema, toolSpecs } from "../src/index";

describe("toJsonSchema — zod가 뱉는 모양을 못박는다", () => {
  // 이 테스트가 존재하는 이유: zod 버전이 올라가도 **와이어로 나가는 모양이 안 흔들리게** 한다.
  // 우리가 통제하지 않는 라이브러리가 프로바이더 요청 본문을 만들고 있으므로.
  test("object 스키마가 통째로 이 모양이다 — **`$schema` 키가 없다**", () => {
    expect(toJsonSchema(z.object({ a: z.number(), b: z.string() }))).toEqual({
      type: "object",
      properties: { a: { type: "number" }, b: { type: "string" } },
      required: ["a", "b"],
    });
  });

  test("`type: 'object'`는 항상 있다 — Anthropic input_schema의 하드 요구", () => {
    expect(toJsonSchema(z.object({})).type).toBe("object");
  });

  test("인자 없는 툴은 properties가 비고 **required 키 자체가 없다**", () => {
    expect(toJsonSchema(z.object({}))).toEqual({ type: "object", properties: {} });
  });

  test(".optional()은 required에서 빠진다", () => {
    expect(toJsonSchema(z.object({ a: z.number(), b: z.number().optional() })).required).toEqual([
      "a",
    ]);
  });

  test("**.default()도 required가 아니다** — io:'input'을 쓰는 이유가 이것이다", () => {
    // 기본값 'output'으로 뽑으면 required가 ["a","unit"]이 된다.
    // 기본값이 있는데도 모델에게 "반드시 보내라"고 말하는 셈이라 틀렸다.
    const schema = z.object({ a: z.number(), unit: z.string().default("cm") });
    expect(toJsonSchema(schema).required).toEqual(["a"]);
  });

  test("표현할 수 없는 타입은 **정의 시점에** 던진다 (늦게 터뜨릴 이유가 없다)", () => {
    expect(() =>
      defineTool({
        name: "bad",
        description: "날짜를 받는다",
        schema: z.object({ when: z.date() }),
        execute: () => "…",
      }),
    ).toThrow(/Date cannot be represented/);
  });
});

describe("defineTool", () => {
  test("spec은 name·description·parameters — 모델이 볼 것만 담는다(실행 함수는 없다)", () => {
    expect(add.spec).toEqual({
      name: "add",
      description: "두 수를 더한다",
      parameters: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
    });
  });

  test("**하나를 적으면 둘이 나온다** — 검증용 zod와 모델용 JSON Schema가 같은 출처다", () => {
    expect(add.schema.safeParse({ a: 1, b: 2 }).success).toBe(true);
    expect(add.schema.safeParse({ a: "1", b: 2 }).success).toBe(false);
    expect(add.spec.parameters.required).toEqual(["a", "b"]);
  });

  test("execute의 인자 타입이 zod에서 추론된다 (F2.1 예제의 드리프트가 사라진다)", () => {
    // 컴파일이 곧 검증이다 — a·b가 number로 추론되지 않으면 typecheck가 깨진다.
    expect(add.execute({ a: 3, b: 4 }, { toolCallId: "call_1" })).toBe(7);
  });

  test("구체 툴이 AnyTool로 대입된다 (execute가 메서드 문법이라 가능하다)", () => {
    const list: AnyTool[] = [add, now];
    expect(toolSpecs(list).map((s) => s.name)).toEqual(["add", "now"]);
  });
});
