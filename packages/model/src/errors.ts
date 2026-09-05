// 모델 링이 던지는 에러. 개념이 필요해진 순간에만 만든다(core/errors.ts와 같은 원칙).
//
// SDK가 이미 던지는 것(인증 실패·레이트리밋·5xx)은 여기 없다 — 그건 SDK의 타입 있는
// 예외를 그대로 통과시킨다. 여기 있는 둘은 **SDK가 에러로 안 보는데 우리에겐 에러인 것**이다.

/**
 * 보낼 대화가 없다. Messages API는 최소 한 개의 user 턴을 요구하는데,
 * system 메시지만 있거나 리스트가 비면 그 조건을 못 맞춘다.
 * 서버까지 갔다가 400을 받느니 호출 전에 끊는 게 낫다.
 */
export class EmptyConversationError extends Error {
  constructor(message = "보낼 대화가 비어 있다 (system 외 메시지가 최소 하나 필요)") {
    super(message);
    this.name = "EmptyConversationError";
  }
}

/**
 * 모델이 안전상 응답을 거절했다. **HTTP는 200이라 SDK는 예외를 안 던진다** —
 * `stop_reason: "refusal"`로 조용히 돌아오므로 content를 읽기 전에 우리가 잡아야 한다.
 */
export class ModelRefusalError extends Error {
  /** 거절 분류(열린 집합: "cyber", "bio", … 또는 없음). */
  readonly category: string | null;
  constructor(category: string | null, explanation?: string | null) {
    super(
      `모델이 응답을 거절했다${category ? ` (${category})` : ""}${explanation ? `: ${explanation}` : ""}`,
    );
    this.name = "ModelRefusalError";
    this.category = category;
  }
}
