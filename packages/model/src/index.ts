// @ariadne/model — 모델 링의 공개 배럴.
//
// 세 층이다(의존은 한 방향):
//   types · errors        중립 어휘. 프로바이더 이름이 없다.
//   anthropic · openaiCompatible   어댑터. **와이어 포맷 하나에 하나씩.**
//   registry              라우터. "provider/model" 문자열을 어댑터+baseURL로 푼다.
//
// 프로바이더가 200개를 넘어도 어댑터는 둘뿐이다 — 나머지 차이는 baseURL과 env 이름이라
// 표(registry.generated.ts)로 들어간다. 이게 mastra가 쓰는 방식이고, langchain처럼
// 프로바이더마다 패키지를 깔게 하는 방식과 갈리는 지점이다.

export type { AnthropicChatConfig, CreateMessage } from "./anthropic";
export { anthropicChat, extractText, toAnthropicMessages } from "./anthropic";
export {
  EmptyConversationError,
  MissingApiKeyError,
  MissingProviderConfigError,
  ModelRefusalError,
  UnknownProviderError,
  UnsupportedProviderError,
} from "./errors";
export type { CreateCompletion, OpenAICompatibleConfig } from "./openaiCompatible";
export { openaiCompatible, toOpenAIMessages } from "./openaiCompatible";
export type { ModelConfig, ProviderEntry, ResolvedSpec } from "./registry";
export { adapterBaseURL, listProviders, model, PROVIDERS, resolveSpec } from "./registry";
export type { ChatModel, ChatOptions } from "./types";
