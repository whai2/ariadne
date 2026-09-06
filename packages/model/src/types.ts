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
  /**
   * 이번 호출에 쓸 수 있는 툴 선언들. 어댑터가 자기 와이어 포맷으로 번역한다.
   *
   * `temperature`를 잘라낸 규칙("모든 프로바이더에서 의미가 통하는 것만")과 부딪히는 것처럼
   * 보이지만 성질이 다르다. temperature는 **뜻이 통하는데 거부**되는 것이었고, tools는
   * 199개 프로바이더에서 같은 뜻이고 하나(`claude-code`)에서만 **와이어에 실을 자리가 없다.**
   * 그래서 잘라내는 대신 `ChatModel.supportsTools`로 드러내고, 못 하는 쪽은 던진다.
   */
  tools?: ToolSpec[];
}

/**
 * 툴의 인자 스키마. **JSON Schema의 object 스키마**여야 한다 —
 * Anthropic `input_schema`가 `type: "object"`를 하드 요구하기 때문에 타입으로 못박는다.
 * (OpenAI `function.parameters`는 더 느슨해서 이 모양을 그대로 받는다.)
 */
export interface JSONSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * 모델에게 보여줄 툴 선언. **실행 함수는 여기 없다** — 이건 "무엇을 부를 수 있는지"를
 * 와이어에 실어 보내는 데이터일 뿐이고, 실제 실행은 `@ariadne/tools`의 몫이다.
 * 그 경계 덕에 모델 링은 툴 링을 몰라도 된다.
 */
export interface ToolSpec {
  name: string;
  description?: string;
  parameters: JSONSchemaObject;
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
  /**
   * **와이어가 툴 정의를 실어 나를 수 있나.** "이 모델이 툴을 잘 부르나"가 아니다 —
   * 그건 모델별 성능이라 우리가 답할 수 없고(F1.5가 모델 목록을 레지스트리에 안 담기로 했다),
   * 못 부르는 모델은 그냥 안 부르고 그래프가 끝난다. 여기서 false인 건 `claude-code`
   * 하나뿐이고, 그건 성능이 아니라 **트랜스포트에 자리가 없어서**다.
   */
  readonly supportsTools: boolean;
  invoke(messages: BaseMessage[], options?: ChatOptions): Promise<AIMessage>;
}
