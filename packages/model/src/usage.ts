import type { TokenUsage } from "@ariadne/core";

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** 누락·잘못된 계측값 때문에 정상 응답을 실패시키거나 사용량 0을 만들지 않는다. */
export function anthropicUsage(raw: unknown): TokenUsage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const input = u.input_tokens;
  const output = u.output_tokens;
  const creation = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  if (!count(input) || !count(output) || !count(creation) || !count(read)) return undefined;
  const total = input + creation + read;
  return count(total) ? { inputTokens: total, outputTokens: output } : undefined;
}

export function openAIUsage(raw: unknown): TokenUsage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  // prompt_tokens는 이미 캐시 토큰을 포함한다. details를 다시 더하지 않는다.
  return count(u.prompt_tokens) && count(u.completion_tokens)
    ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens }
    : undefined;
}
