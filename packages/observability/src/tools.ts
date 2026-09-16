import { describeError, type SpanContext, snapshot } from "./span";

type ToolShape = { readonly name: string; execute(...args: never[]): unknown };

/** 원래 선언·schema를 유지하고 execute만 감싼다. */
export function tracedTool<T extends ToolShape>(
  tool: T,
  parent: SpanContext,
): Omit<T, "execute"> & {
  execute(...args: Parameters<T["execute"]>): Promise<Awaited<ReturnType<T["execute"]>>>;
} {
  return {
    ...tool,
    async execute(...args: Parameters<T["execute"]>): Promise<Awaited<ReturnType<T["execute"]>>> {
      const span = parent.child({
        kind: "tool",
        name: `execute_tool ${tool.name}`,
        input: args[0],
        attributes: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": tool.name },
      });
      const context = snapshot(args[1]);
      if (
        typeof context === "object" &&
        context !== null &&
        "toolCallId" in context &&
        typeof context.toolCallId === "string"
      ) {
        span.set({ "gen_ai.tool.call.id": context.toolCallId });
      }
      try {
        const output = await (
          tool.execute as (...values: Parameters<T["execute"]>) => ReturnType<T["execute"]>
        ).apply(tool, args);
        span.end({ output });
        return output;
      } catch (error) {
        span.end({ error: describeError(error) });
        throw error;
      }
    },
  };
}
