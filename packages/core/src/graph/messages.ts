// 최소 메시지 타입 + addMessages 리듀서 (V8 캡스톤). 런타임 의존성 0.
// "대화 상태 = messages 리스트"라는 교과서 챗봇 패턴을 core만으로 표현한다.
// 핵심: addMessages는 그냥 "리듀서 함수"라, V3부터 있던 리듀서 채널에 그대로 꽂힌다.
// langgraph 대응: graph/message.py (BaseMessage / add_messages / MessagesState).
//
// F2.1에서 툴 호출 어휘(ToolCall · "tool" 역할 · ToolMessage)가 여기 더해졌다.
// **core에서 이 파일만 바뀌었다** — addMessages도 채널도 엔진도 그대로다. 리듀서가
// content를 안 보기 때문이고, 그래서 F2도 V8과 같은 성질이다(어휘만 넓어진다).
// langgraph 대응: langchain_core messages/{ai,tool}.py (AIMessage.tool_calls / ToolMessage).

import type { StateSchema } from "./types";

/**
 * 모델이 요청한 툴 호출 하나 (F2.1).
 *
 * **`id`가 이 타입의 존재 이유다.** 결과 메시지가 이 id를 그대로 되돌려줘야 모델이
 * "어느 호출의 답인지" 안다 — 하나라도 답이 없으면 다음 호출이 양쪽 프로바이더에서 400이다.
 * 그래서 id는 **프로바이더가 발급한 것을 그대로 나른다**(우리가 만들지 않는다).
 */
export interface ToolCall {
  /** 프로바이더가 준 호출 id. 결과 메시지의 `toolCallId`와 짝을 이룬다. */
  id: string;
  name: string;
  /**
   * 파싱된 인자 객체. Anthropic은 이미 객체로 주지만 **OpenAI는 JSON 문자열로 준다** —
   * 그 비대칭은 어댑터가 여기서 흡수한다(중립 어휘는 객체 하나만 안다).
   */
  args: Record<string, unknown>;
  /**
   * 인자를 파싱하지 못했을 때의 원문. **성공하면 키 자체가 없다.**
   * OpenAI는 `arguments`가 유효한 JSON이 아닐 수 있다고 문서에 명시한다 — 원문을 안 실으면
   * 실행기가 "필수 인자 누락"으로 오진한다(진짜 원인은 JSON 파손).
   */
  invalidArgs?: string;
}

/** 대화 메시지 한 개. role로 종류 구분. id가 있으면 addMessages가 같은 id를 갱신한다. */
export interface BaseMessage {
  role: "human" | "ai" | "system" | "tool";
  content: string;
  /** addMessages가 id로 같은 메시지를 교체한다(없으면 항상 append). */
  id?: string;
}
export interface HumanMessage extends BaseMessage {
  role: "human";
}
export interface AIMessage extends BaseMessage {
  role: "ai";
  /**
   * 모델이 요청한 툴 호출들. **없으면 키 자체가 없다**(id와 같은 규칙).
   *
   * `content`를 블록 배열로 넓히는 대신 **곁들임 필드**로 둔 게 F2의 설계 선택이다.
   * 두 와이어 포맷 중 OpenAI가 이미 이 모양이고(content와 tool_calls가 형제 필드),
   * Anthropic의 블록 배열은 어댑터가 조립하면 된다. 대가는 멀티모달 — 이미지 블록이
   * 필요해지면 그때 `content`를 넓힌다.
   */
  toolCalls?: ToolCall[];
}
export interface SystemMessage extends BaseMessage {
  role: "system";
}
/**
 * 툴 실행 결과 하나 (F2.1).
 *
 * **호출 하나당 이 메시지가 정확히 하나**다. 중립형이 "결과 1개 = 메시지 1개"인 건 취향이
 * 아니라 `addMessages` 때문이다 — 리듀서가 주소를 붙일 수 있는 단위가 메시지라서,
 * 결과를 묶어두면 id 교체 규칙이 개별 결과에 닿지 못한다.
 * (Anthropic 와이어는 한 턴의 결과를 한 메시지에 모아야 하지만 **그건 와이어의 사정**이라
 * 어댑터가 접는다.)
 */
export interface ToolMessage extends BaseMessage {
  role: "tool";
  /** 어느 호출의 결과인가. `ToolCall.id`와 같아야 한다. */
  toolCallId: string;
  /** 실패했을 때만. Anthropic은 `is_error`로, OpenAI는 본문 텍스트로 나간다. */
  status?: "error";
}

/** 사람 메시지 생성. `human("안녕")` 또는 id를 붙여 `human("안녕", "u1")`. */
export function human(content: string, id?: string): HumanMessage {
  return id === undefined ? { role: "human", content } : { role: "human", content, id };
}
/**
 * AI(어시스턴트) 메시지 생성.
 *
 * `id`와 `toolCalls`는 **없으면 키를 아예 안 만든다.** 이건 취향이 아니라 계약이다 —
 * 툴을 안 쓰는 기존 코드/테스트가 `ai("답")`을 `{role, content}`와 통째로 비교하고 있어서,
 * 빈 배열이라도 실으면 전부 깨진다.
 */
export function ai(content: string, id?: string, toolCalls?: ToolCall[]): AIMessage {
  return {
    role: "ai",
    content,
    ...(id === undefined ? {} : { id }),
    ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { toolCalls }),
  };
}
/** 시스템 메시지 생성. */
export function system(content: string, id?: string): SystemMessage {
  return id === undefined ? { role: "system", content } : { role: "system", content, id };
}
/**
 * 툴 결과 메시지 생성. `tool("call_1", "7")` 또는 실패면 `tool("call_1", "…", "error")`.
 *
 * **id를 안 받는다.** `toolCallId`는 "어느 호출의 답인가"이고 `id`는 "이 메시지를 교체할 열쇠"라
 * 서로 다른 개념인데, 둘을 같게 두면 툴을 재실행할 때 앞 결과를 조용히 덮어쓴다.
 * 결과는 항상 append다.
 */
export function tool(toolCallId: string, content: string, status?: "error"): ToolMessage {
  return {
    role: "tool",
    content,
    toolCallId,
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * `role`만으로는 좁혀지지 않는다 — `BaseMessage`는 판별 유니온이 아니라 **부모 인터페이스**라,
 * `msg.role === "ai"`를 봐도 TS는 `toolCalls`가 있는 줄 모른다. 어댑터마다 캐스팅을 흩뿌리는
 * 대신 가드를 여기 한 곳에 둔다(둘 다 어댑터 두 곳에서 쓰인다).
 */
export function isAIMessage(msg: BaseMessage): msg is AIMessage {
  return msg.role === "ai";
}
/** 위와 같은 이유. `toolCallId`를 읽으려면 필요하다. */
export function isToolMessage(msg: BaseMessage): msg is ToolMessage {
  return msg.role === "tool";
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
