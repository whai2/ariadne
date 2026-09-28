import { defineDataset } from "../dataset";

interface BfclTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface BfclInput {
  messages: Array<{ role: "user"; content: string }>;
  tools: BfclTool[];
}

interface BfclCase {
  id: string;
  input: BfclInput;
  expected: { calls: Array<{ name: string }> };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): BfclTool {
  return { name, description, parameters: { type: "object", properties, required } };
}

function bfclCase(
  id: string,
  question: string,
  availableTool: BfclTool,
  shouldCall: boolean,
): BfclCase {
  return {
    id,
    input: {
      messages: [{ role: "user", content: question }],
      tools: [availableTool],
    },
    expected: { calls: shouldCall ? [{ name: availableTool.name }] : [] },
  };
}

const callCase = (id: string, question: string, availableTool: BfclTool): BfclCase =>
  bfclCase(id, question, availableTool, true);

const skipCase = (id: string, question: string, availableTool: BfclTool): BfclCase =>
  bfclCase(id, question, availableTool, false);

/**
 * BFCL V4의 고정 12건 발췌본.
 *
 * 원본 commit: 6ea57973c7a6097fd7c5915698c54c17c5b1b6c8
 * 원본 파일: BFCL_v4_simple_javascript.json, BFCL_v4_irrelevance.json 및 possible_answer.
 * 변경: BFCL의 `dict`/대문자 타입 표기를 JSON Schema 표기로 정규화하고 대화 중 첫 user 턴만 폈다.
 * 라이선스와 출처: ../../datasets/BFCL-NOTICE.md
 */
export const BFCL_V4_MINI = defineDataset({
  name: "bfcl-v4-mini",
  version: "6ea5797",
  cases: [
    callCase(
      "simple_javascript_0",
      "Help me validate user input in a form field with the ID 'userInputField' after the user has finished typing?",
      tool(
        "validateUserInput",
        "This function is called after a user has finished typing in a form field, to validate the input provided.",
        {
          inputField: { type: "string", description: "The form field to validate." },
          isComplete: { type: "boolean", description: "Whether typing is finished." },
        },
        ["inputField", "isComplete"],
      ),
    ),
    callCase(
      "simple_javascript_1",
      "Help me extract all data entries with the attribute 'data-active' set to true from a list element stored in a variable named 'listElement'?",
      tool(
        "getActiveDataEntries",
        "Extract entries from a list element by attribute and value.",
        {
          listElement: { description: "The list element to inspect." },
          attribute: { type: "string", default: "data-active" },
          value: { type: "boolean", default: true },
        },
        ["listElement"],
      ),
    ),
    callCase(
      "simple_javascript_3",
      "Help me send a 'submit' action to a React form with the ID 'loginForm' at a coordinate that is 30% from the top and 60% from the left?",
      tool(
        "submitAtCoordinate",
        "Send an action to a React form at relative coordinates.",
        {
          action: { type: "string" },
          formId: { type: "string" },
          coordinates: { type: "array", items: { type: "number" } },
        },
        ["action", "formId", "coordinates"],
      ),
    ),
    callCase(
      "simple_javascript_4",
      "Help me verify if an email address 'example@domain.com' conforms to the standard email format, optionally allowing for custom domain validation with 'domain.com'?",
      tool(
        "emailFormatValidator",
        "Validate an email address and optionally require a domain.",
        { email: { type: "string" }, domain: { type: "string", default: "" } },
        ["email"],
      ),
    ),
    callCase(
      "simple_javascript_6",
      "Help me create a mapping that assigns each of the first 4 elements from a given array to the category 'transition' for use in CSS transitions?",
      tool(
        "mapTransitions",
        "Map a limited number of array elements to a category.",
        { category: { type: "string" }, limit: { type: "number" } },
        ["category", "limit"],
      ),
    ),
    callCase(
      "simple_javascript_7",
      "In the context of analyzing JSON data structures, help me extract all key-value pairs that follow a specific key within a data analysis context object named 'dataAnalysisContext' that initially has a key of 'userId'?",
      tool(
        "getNextKeyValues",
        "Extract key-value pairs following a specified key in a JSON traversal context.",
        { ctx: { description: "JSON traversal context." }, currentKey: { type: "string" } },
        ["ctx", "currentKey"],
      ),
    ),
    skipCase(
      "irrelevance_0",
      "Calculate the area of a triangle given the base is 10 meters and height is 5 meters.",
      tool(
        "determine_body_mass_index",
        "Calculate body mass index from weight and height.",
        { weight: { type: "number" }, height: { type: "number" } },
        ["weight", "height"],
      ),
    ),
    skipCase(
      "irrelevance_1",
      "Solve the quadratic equation with coefficients a = 1, b = 2, and c = 3.",
      tool(
        "math.sum",
        "Compute the sum of all numbers in a list.",
        { numbers: { type: "array", items: { type: "number" } } },
        ["numbers"],
      ),
    ),
    skipCase(
      "irrelevance_2",
      "Solve for the roots of the equation 3x^2 - 2x - 5.",
      tool(
        "distance_calculator.calculate",
        "Calculate distance between two geographical coordinates.",
        {
          coordinate_1: { type: "array", items: { type: "number" } },
          coordinate_2: { type: "array", items: { type: "number" } },
        },
        ["coordinate_1", "coordinate_2"],
      ),
    ),
    skipCase(
      "irrelevance_3",
      "What is the slope of the line perpendicular to y = 3x + 2?",
      tool(
        "find_critical_points",
        "Find critical points of a function.",
        { function: { type: "string" }, variable: { type: "string" } },
        ["function", "variable"],
      ),
    ),
    skipCase(
      "irrelevance_4",
      "What are the roots of the linear equation bx + c = 0?",
      tool(
        "find_roots",
        "Find roots of a quadratic equation ax^2 + bx + c = 0.",
        { a: { type: "number" }, b: { type: "number" }, c: { type: "number" } },
        ["a", "b", "c"],
      ),
    ),
    skipCase(
      "irrelevance_5",
      "What is the perimeter of a rectangle with length 5 meters and width 4 meters?",
      tool(
        "solve_quadratic_equation",
        "Solve a quadratic equation.",
        { a: { type: "number" }, b: { type: "number" }, c: { type: "number" } },
        ["a", "b", "c"],
      ),
    ),
  ],
});
