// 최소 메시지 타입 + addMessages 리듀서 (V8 캡스톤). 런타임 의존성 0.
// "대화 상태 = messages 리스트"라는 교과서 챗봇 패턴을 core만으로 표현한다.
// 핵심: addMessages는 그냥 "리듀서 함수"라, V3부터 있던 리듀서 채널에 그대로 꽂힌다.
// langgraph 대응: graph/message.py (BaseMessage / add_messages / MessagesState).

import type { StateSchema } from "./types";

/** 대화 메시지 한 개. role로 종류 구분. id가 있으면 addMessages가 같은 id를 갱신한다. */
export interface BaseMessage {
  role: "human" | "ai" | "system";
  content: string;
  /** addMessages가 id로 같은 메시지를 교체한다(없으면 항상 append). */
  id?: string;
}
export interface HumanMessage extends BaseMessage {
  role: "human";
}
export interface AIMessage extends BaseMessage {
  role: "ai";
}
export interface SystemMessage extends BaseMessage {
  role: "system";
}

/** 사람 메시지 생성. `human("안녕")` 또는 id를 붙여 `human("안녕", "u1")`. */
export function human(content: string, id?: string): HumanMessage {
  return id === undefined ? { role: "human", content } : { role: "human", content, id };
}
/** AI(어시스턴트) 메시지 생성. */
export function ai(content: string, id?: string): AIMessage {
  return id === undefined ? { role: "ai", content } : { role: "ai", content, id };
}
/** 시스템 메시지 생성. */
export function system(content: string, id?: string): SystemMessage {
  return id === undefined ? { role: "system", content } : { role: "system", content, id };
}

/**
 * 메시지 리스트 리듀서: `right`를 `left` 뒤에 append.
 * **단** `right`의 메시지가 `left`의 어떤 메시지와 **같은 id**를 가지면 그 자리를 교체한다
 * (append-only의 유일한 예외 — 스트리밍 중 부분 AI 메시지 갱신 등에 쓰인다).
 * langgraph 대응: graph/message.py 의 add_messages.
 */
export function addMessages(left: BaseMessage[], right: BaseMessage[]): BaseMessage[] {
  const merged = [...left];
  for (const msg of right) {
    const idx = msg.id === undefined ? -1 : merged.findIndex((m) => m.id === msg.id);
    if (idx === -1) {
      merged.push(msg);
    } else {
      merged[idx] = msg; // 같은 id → 교체
    }
  }
  return merged;
}

/** 대화 상태의 최소 형태. langgraph 대응: MessagesState. */
export interface MessagesState {
  messages: BaseMessage[];
}

/** MessagesState용 스키마: messages는 addMessages로 누적. `new StateGraph(messagesSchema)`. */
export const messagesSchema: StateSchema<MessagesState> = {
  messages: { reducer: addMessages },
};
