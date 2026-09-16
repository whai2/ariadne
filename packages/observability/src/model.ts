import type { AIMessage, BaseMessage } from "@ariadne/core";
import { describeError, type SpanContext } from "./span";

/** model 링에 의존하지 않고 호출 형태만 요구한다. 옵션은 원래 타입을 보존한다. */
export interface TraceableModel<O> {
  readonly provider: string;
  readonly modelId: string;
  readonly supportsTools: boolean;
  invoke(messages: BaseMessage[], options?: O): Promise<AIMessage>;
}
export function tracedModel<O>(model: TraceableModel<O>, parent: SpanContext): TraceableModel<O> {
  return {
    provider: model.provider,
    modelId: model.modelId,
    supportsTools: model.supportsTools,
    async invoke(messages, options) {
      const span = parent.child({
        kind: "model",
        name: `chat ${model.modelId}`,
        input: messages,
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": model.provider,
          "gen_ai.request.model": model.modelId,
        },
      });
      try {
        const output = await model.invoke(messages, options);
        span.end({
          output,
          attributes:
            output.usage === undefined
              ? {}
              : {
                  "gen_ai.usage.input_tokens": output.usage.inputTokens,
                  "gen_ai.usage.output_tokens": output.usage.outputTokens,
                },
        });
        return output;
      } catch (error) {
        span.end({ error: describeError(error) });
        throw error;
      }
    },
  };
}
