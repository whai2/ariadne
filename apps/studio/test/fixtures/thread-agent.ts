import { createAgent } from "@ariadne/agent";
import {
  ai,
  isToolMessage,
  type MessagesState,
  messagesSchema,
  type StateSchema,
} from "@ariadne/core";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { approvalPolicy } from "../../src/domain/graph";
import type { AgentDef } from "../../src/domain/registry";
import type { AgentServiceOptions } from "../../src/services/agents";

export function setup() {
  const ran: string[] = [];
  let fail = false;
  const tool = defineTool({
    name: "write",
    description: "기록만 하는 도구",
    schema: z.object({ text: z.string() }),
    execute: ({ text }) => {
      ran.push(text);
      return text;
    },
  });
  const def: AgentDef = {
    id: "fake",
    name: "Fake",
    description: "",
    model: "fake/test",
    tools: [tool],
    approval: ["write"],
    budget: 5,
  };
  const options: AgentServiceOptions = {
    definitions: [def],
    buildGraph: (_def, _preview, decision, hooks) =>
      createAgent<MessagesState>({
        schema: {
          ...messagesSchema,
          budget: { reducer: (a: number, b: number) => a + b },
        } as StateSchema<MessagesState>,
        model: {
          provider: "fake",
          modelId: "test",
          supportsTools: true,
          async invoke(messages) {
            if (fail) throw new Error("model failed");
            return messages.some(isToolMessage)
              ? ai("done")
              : ai("", undefined, [{ id: "call", name: "write", args: { text: "saved" } }]);
          },
        },
        tools: [tool],
        approval: approvalPolicy(["write"], decision, hooks),
      }),
  };
  return {
    options,
    ran,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}
