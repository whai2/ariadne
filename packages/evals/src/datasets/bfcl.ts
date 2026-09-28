import { defineDataset } from "../dataset";

export interface BfclInput {
  messages: Array<{ role: "user"; content: string }>;
  tools: Array<{
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
  }>;
}

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): BfclInput["tools"][number] {
  return { name, description, parameters: { type: "object", properties, required } };
}

/**
 * BFCL V4의 고정 12건 발췌본.
 *
 * 원본 commit: 6ea57973c7a6097fd7c5915698c54c17c5b1b6c8
 * 원본 파일: BFCL_v4_simple_javascript.json, BFCL_v4_irrelevance.json 및 possible_answer.
 * 변경: BFCL의 `dict`/대문자 타입 표기를 JSON Schema 표기로 정규화하고 대화 중 첫 user 턴만 폈다.
 * 라이선스와 출처: ../../datasets/BFCL-NOTICE.md
 */
export const BFCL_V4_MINI = defineDataset<BfclInput, { calls: Array<{ name: string }> }>({
  name: "bfcl-v4-mini",
  version: "6ea5797",
  cases: [
    {
      id: "simple_javascript_0",
      input: {
        messages: [
          {
            role: "user",
            content:
              "Help me validate user input in a form field with the ID 'userInputField' after the user has finished typing?",
          },
        ],
        tools: [
          fn(
            "validateUserInput",
            "This function is called after a user has finished typing in a form field, to validate the input provided.",
            {
              inputField: { type: "string", description: "The form field to validate." },
              isComplete: { type: "boolean", description: "Whether typing is finished." },
            },
            ["inputField", "isComplete"],
          ),
        ],
      },
      expected: {
        calls: [{ name: "validateUserInput" }],
      },
    },
    {
      id: "simple_javascript_1",
      input: {
        messages: [
          {
            role: "user",
            content:
              "Help me extract all data entries with the attribute 'data-active' set to true from a list element stored in a variable named 'listElement'?",
          },
        ],
        tools: [
          fn(
            "getActiveDataEntries",
            "Extract entries from a list element by attribute and value.",
            {
              listElement: { description: "The list element to inspect." },
              attribute: { type: "string", default: "data-active" },
              value: { type: "boolean", default: true },
            },
            ["listElement"],
          ),
        ],
      },
      expected: {
        calls: [{ name: "getActiveDataEntries" }],
      },
    },
    {
      id: "simple_javascript_3",
      input: {
        messages: [
          {
            role: "user",
            content:
              "Help me send a 'submit' action to a React form with the ID 'loginForm' at a coordinate that is 30% from the top and 60% from the left?",
          },
        ],
        tools: [
          fn(
            "submitAtCoordinate",
            "Send an action to a React form at relative coordinates.",
            {
              action: { type: "string" },
              formId: { type: "string" },
              coordinates: { type: "array", items: { type: "number" } },
            },
            ["action", "formId", "coordinates"],
          ),
        ],
      },
      expected: {
        calls: [{ name: "submitAtCoordinate" }],
      },
    },
    {
      id: "simple_javascript_4",
      input: {
        messages: [
          {
            role: "user",
            content:
              "Help me verify if an email address 'example@domain.com' conforms to the standard email format, optionally allowing for custom domain validation with 'domain.com'?",
          },
        ],
        tools: [
          fn(
            "emailFormatValidator",
            "Validate an email address and optionally require a domain.",
            { email: { type: "string" }, domain: { type: "string", default: "" } },
            ["email"],
          ),
        ],
      },
      expected: {
        calls: [{ name: "emailFormatValidator" }],
      },
    },
    {
      id: "simple_javascript_6",
      input: {
        messages: [
          {
            role: "user",
            content:
              "Help me create a mapping that assigns each of the first 4 elements from a given array to the category 'transition' for use in CSS transitions?",
          },
        ],
        tools: [
          fn(
            "mapTransitions",
            "Map a limited number of array elements to a category.",
            { category: { type: "string" }, limit: { type: "number" } },
            ["category", "limit"],
          ),
        ],
      },
      expected: {
        calls: [{ name: "mapTransitions" }],
      },
    },
    {
      id: "simple_javascript_7",
      input: {
        messages: [
          {
            role: "user",
            content:
              "In the context of analyzing JSON data structures, help me extract all key-value pairs that follow a specific key within a data analysis context object named 'dataAnalysisContext' that initially has a key of 'userId'?",
          },
        ],
        tools: [
          fn(
            "getNextKeyValues",
            "Extract key-value pairs following a specified key in a JSON traversal context.",
            { ctx: { description: "JSON traversal context." }, currentKey: { type: "string" } },
            ["ctx", "currentKey"],
          ),
        ],
      },
      expected: {
        calls: [{ name: "getNextKeyValues" }],
      },
    },
    ...[
      {
        id: "irrelevance_0",
        question:
          "Calculate the area of a triangle given the base is 10 meters and height is 5 meters.",
        tool: fn(
          "determine_body_mass_index",
          "Calculate body mass index from weight and height.",
          { weight: { type: "number" }, height: { type: "number" } },
          ["weight", "height"],
        ),
      },
      {
        id: "irrelevance_1",
        question: "Solve the quadratic equation with coefficients a = 1, b = 2, and c = 3.",
        tool: fn(
          "math.sum",
          "Compute the sum of all numbers in a list.",
          { numbers: { type: "array", items: { type: "number" } } },
          ["numbers"],
        ),
      },
      {
        id: "irrelevance_2",
        question: "Solve for the roots of the equation 3x^2 - 2x - 5.",
        tool: fn(
          "distance_calculator.calculate",
          "Calculate distance between two geographical coordinates.",
          {
            coordinate_1: { type: "array", items: { type: "number" } },
            coordinate_2: { type: "array", items: { type: "number" } },
          },
          ["coordinate_1", "coordinate_2"],
        ),
      },
      {
        id: "irrelevance_3",
        question: "What is the slope of the line perpendicular to y = 3x + 2?",
        tool: fn(
          "find_critical_points",
          "Find critical points of a function.",
          { function: { type: "string" }, variable: { type: "string" } },
          ["function", "variable"],
        ),
      },
      {
        id: "irrelevance_4",
        question: "What are the roots of the linear equation bx + c = 0?",
        tool: fn(
          "find_roots",
          "Find roots of a quadratic equation ax^2 + bx + c = 0.",
          { a: { type: "number" }, b: { type: "number" }, c: { type: "number" } },
          ["a", "b", "c"],
        ),
      },
      {
        id: "irrelevance_5",
        question: "What is the perimeter of a rectangle with length 5 meters and width 4 meters?",
        tool: fn(
          "solve_quadratic_equation",
          "Solve a quadratic equation.",
          { a: { type: "number" }, b: { type: "number" }, c: { type: "number" } },
          ["a", "b", "c"],
        ),
      },
    ].map(({ id, question, tool }) => ({
      id,
      input: { messages: [{ role: "user" as const, content: question }], tools: [tool] },
      expected: { calls: [] },
    })),
  ],
});
