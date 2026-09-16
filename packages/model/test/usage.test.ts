import { expect, test } from "bun:test";
import { ai, human } from "@ariadne/core";
import { claudeCodeChat, parseResult } from "../src";
import { anthropicUsage, openAIUsage } from "../src/usage";

test("미보고·불완전·잘못된 사용량은 없고 보고된 0은 보존한다", () => {
  for (const raw of [
    undefined,
    null,
    {},
    { input_tokens: 1 },
    { input_tokens: -1, output_tokens: 2 },
    { input_tokens: NaN, output_tokens: 2 },
    { input_tokens: 1.2, output_tokens: 2 },
    { input_tokens: "1", output_tokens: 2 },
    { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: -1 },
  ]) {
    expect(anthropicUsage(raw)).toBeUndefined();
  }
  expect(anthropicUsage({ input_tokens: 0, output_tokens: 0 })).toEqual({
    inputTokens: 0,
    outputTokens: 0,
  });
  expect(openAIUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
    inputTokens: 0,
    outputTokens: 0,
  });
  expect(openAIUsage({ prompt_tokens: 1 })).toBeUndefined();
  expect(ai("ok")).not.toHaveProperty("usage");
});

test("Claude Code text/tool 응답은 CLI 집계 usage를 보존한다", async () => {
  for (const promptedTools of [false, true]) {
    const result = promptedTools ? '{"tool_calls":[{"name":"ping","arguments":{}}]}' : "ok";
    const stdout = JSON.stringify({
      subtype: "success",
      result,
      usage: {
        input_tokens: 2,
        output_tokens: 3,
        cache_creation_input_tokens: 4,
        cache_read_input_tokens: 5,
      },
      modelUsage: { ignored: { inputTokens: 999 } },
    });
    const model = claudeCodeChat({ promptedTools, run: async () => stdout });
    const response = await model.invoke(
      [human("hi")],
      promptedTools ? { tools: [{ name: "ping", parameters: { type: "object" } }] } : {},
    );
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    if (promptedTools) expect(response.toolCalls?.[0]?.name).toBe("ping");
    expect(parseResult(stdout)).toBe(result);
  }
});

test("Claude Code는 usage 없이도 정상 응답을 반환한다", async () => {
  for (const usage of [undefined, { input_tokens: 1 }]) {
    const model = claudeCodeChat({
      run: async () => JSON.stringify({ subtype: "success", result: "ok", usage }),
    });
    expect(await model.invoke([human("hi")])).toEqual({ role: "ai", content: "ok" });
  }
});
