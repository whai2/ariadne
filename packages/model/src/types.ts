// 프로바이더 중립 어휘. **여기엔 어떤 프로바이더 이름도 등장하지 않는다.**
//
// 그래프 노드는 `ChatModel`만 알고, 뒤에 Anthropic이 있는지 다른 무엇이 있는지 모른다.
// 이 격리가 모델 링의 존재 이유다 — 프로바이더를 바꿔도 그래프는 안 바뀐다.

import type { AIMessage, BaseMessage } from "@ariadne/core";

/**
 * 한 번의 모델 호출 옵션. **프로바이더 공통으로 의미가 통하는 것만** 둔다.
 * (프로바이더 전용 손잡이는 각 어댑터의 생성 설정으로 간다 — 여기에 새면 중립성이 깨진다.)
 *
 * `temperature`가 없는 건 실수가 아니다: 현행 Claude 모델은 샘플링 파라미터를 거부한다(400).
 * "모든 프로바이더에 있는 옵션"이 아니므로 중립 어휘에 들어올 자격이 없다.
 */
export interface ChatOptions {
  /** 시스템 지시. 메시지 리스트 안의 system 역할과 합쳐진다. */
  system?: string;
  /** 응답 최대 토큰. 어댑터가 기본값을 갖는다. */
  maxTokens?: number;
  /** 호출 취소. */
  signal?: AbortSignal;
}

/**
 * 채팅 모델 한 개. `invoke`가 전부다 — 대화를 주면 다음 AI 메시지를 돌려준다.
 *
 * 반환이 `AIMessage`인 게 핵심이다. core의 `addMessages` 리듀서에 그대로 꽂히므로
 * 그래프 노드는 `{ messages: [await model.invoke(s.messages)] }` 한 줄이면 된다(V8).
 */
export interface ChatModel {
  /** 어느 프로바이더인가. 라우팅/관찰용 라벨. */
  readonly provider: string;
  /** 그 프로바이더 안에서의 모델 식별자. */
  readonly modelId: string;
  invoke(messages: BaseMessage[], options?: ChatOptions): Promise<AIMessage>;
}
