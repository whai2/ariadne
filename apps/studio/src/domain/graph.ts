import { type Approval, type ApprovalPolicy, askFor, createAgent } from "@ariadne/agent";
import type { CompiledGraph, MessagesState, StateSchema } from "@ariadne/core";
import { messagesSchema } from "@ariadne/core";
import type { ScoredFact } from "@ariadne/memory";
import { type ChatModel, model } from "@ariadne/model";
import type { GraphTrace } from "@ariadne/observability";
import type { AgentDef } from "./registry";

const previewModel: ChatModel = {
  provider: "preview",
  modelId: "preview",
  supportsTools: true,
  async invoke() {
    return { role: "ai", content: "(미리보기)" };
  },
};

export interface TurnHooks {
  onDecision?(kind: "allow" | "deny", targets: readonly string[]): void;
}

export function approvalPolicy(
  names: string[],
  decision?: Approval,
  hooks?: TurnHooks,
): ApprovalPolicy {
  const gate = askFor(names);
  const risky = new Set(names);
  let once = decision;
  return async (calls) => {
    const targets = calls.map((c) => c.name).filter((n) => risky.has(n));
    const verdict = once ?? (await gate(calls));
    once = undefined;
    if (verdict !== "ask") hooks?.onDecision?.(verdict, targets);
    return verdict;
  };
}

export function composeSystem(
  base: string | undefined,
  facts: readonly ScoredFact[],
): string | undefined {
  if (facts.length === 0) return base;
  const block = ["[기억한 것]", ...facts.map((f) => `- ${f.text}`)].join("\n");
  return [base, block].filter((x): x is string => x !== undefined && x !== "").join("\n\n");
}

/** 대화 말고도 채널이 있는 에이전트의 상태 (F5.2). */
export interface BudgetState extends MessagesState {
  budget: number;
}

export function buildAgentGraph(
  def: AgentDef,
  preview = false,
  decision?: Approval,
  hooks?: TurnHooks,
  facts: readonly ScoredFact[] = [],
  trace?: GraphTrace,
): CompiledGraph<MessagesState> {
  const chatModel = preview
    ? previewModel
    : model(def.model, { promptedTools: def.tools.length > 0 });
  const gated = def.tools.length > 0 && (def.approval?.length ?? 0) > 0;
  // 선언(숫자)을 여기서 살아있는 것(리듀서)으로 바꾼다. 합계 리듀서라 입력이 **델타**가 된다.
  const schema: StateSchema<BudgetState> | undefined =
    def.budget === undefined
      ? undefined
      : { ...messagesSchema, budget: { reducer: (a, b) => a + b } };
  return createAgent({
    model: chatModel,
    ...(trace === undefined ? {} : { trace }),
    tools: def.tools,
    ...(schema === undefined ? {} : { schema: schema as StateSchema<MessagesState> }),
    ...(() => {
      const system = composeSystem(def.system, facts);
      return system === undefined ? {} : { system };
    })(),
    ...(def.maxToolRounds === undefined ? {} : { maxToolRounds: def.maxToolRounds }),
    ...(gated ? { approval: approvalPolicy(def.approval ?? [], decision, hooks) } : {}),
  });
}
