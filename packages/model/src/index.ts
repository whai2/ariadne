// @ariadne/model — 모델 링의 공개 배럴.
//
// 두 층이다(의존은 한 방향):
//   types · errors        중립 어휘. 프로바이더 이름이 없다.
//   anthropic             어댑터. 중립 어휘를 특정 프로바이더 위에 구현한다.
//
// 프로바이더가 둘이 되면 어댑터 파일이 하나 더 생기고, 그때 라우팅(레지스트리)을 추출한다.
// 지금은 하나뿐이라 만들지 않는다.

export type { AnthropicChatConfig, CreateMessage } from "./anthropic";
export { anthropicChat, extractText, toAnthropicMessages } from "./anthropic";
export { EmptyConversationError, ModelRefusalError } from "./errors";
export type { ChatModel, ChatOptions } from "./types";
