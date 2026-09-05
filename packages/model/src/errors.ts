// 모델 링이 던지는 에러. 개념이 필요해진 순간에만 만든다(core/errors.ts와 같은 원칙).
//
// SDK가 이미 던지는 것(인증 실패·레이트리밋·5xx)은 여기 없다 — 그건 SDK의 타입 있는
// 예외를 그대로 통과시킨다. 여기 있는 것들은 **SDK가 에러로 안 보는데 우리에겐 에러인 것**,
// 그리고 **호출까지 갈 필요도 없이 라우팅 단계에서 끊을 수 있는 것**이다.

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

/** 레지스트리에 없는 프로바이더거나, 스펙 문자열이 `"provider/model"` 꼴이 아니다. */
export class UnknownProviderError extends Error {
  readonly provider: string;
  constructor(provider: string, hint?: string) {
    super(
      hint ?? `모르는 프로바이더 "${provider}" (bun run --filter '@ariadne/model' sync 로 갱신)`,
    );
    this.name = "UnknownProviderError";
    this.provider = provider;
  }
}

/**
 * 레지스트리엔 있는데 **우리 어댑터로는 못 부른다.** 와이어 포맷이 anthropic도 OpenAI 호환도
 * 아닌 경우(Google·Bedrock·Vertex 등). 조용히 실패하느니 뭐가 필요한지 말해준다.
 */
export class UnsupportedProviderError extends Error {
  readonly provider: string;
  constructor(provider: string, name: string, npm?: string) {
    super(
      `"${provider}" (${name})는 아직 어댑터가 없다` +
        `${npm ? ` — ${npm} 계열 와이어 포맷이 필요하다` : ""}. ` +
        `지금 지원: anthropic 포맷 · OpenAI 호환 포맷.`,
    );
    this.name = "UnsupportedProviderError";
    this.provider = provider;
  }
}

/**
 * 키는 있는데 **baseURL을 조립할 값이 없다.** Databricks·Snowflake처럼 워크스페이스마다
 * URL이 다른 프로바이더가 여기 걸린다 — 키만으론 어디로 보낼지 모른다.
 */
export class MissingProviderConfigError extends Error {
  readonly provider: string;
  readonly missing: string[];
  constructor(provider: string, missing: string[], template: string) {
    super(
      `"${provider}"의 baseURL을 만들 수 없다 — ${missing.join(" · ")} 가 필요하다 (형식: ${template})`,
    );
    this.name = "MissingProviderConfigError";
    this.provider = provider;
    this.missing = missing;
  }
}

/**
 * `claude` 서브프로세스가 실패했다. HTTP가 아니므로 상태 코드가 없고,
 * **종료 코드·stderr·JSON의 subtype**이 실패 신호다.
 * 흔한 원인: 바이너리 없음 · 로그인 안 됨 · 사용량 한도.
 */
export class ClaudeCodeError extends Error {
  constructor(detail: string) {
    super(`Claude Code ${detail}`);
    this.name = "ClaudeCodeError";
  }
}

/** API 키를 못 찾았다. **어느 환경변수를 채워야 하는지 이름을 알려준다.** */
export class MissingApiKeyError extends Error {
  readonly provider: string;
  readonly envVars: string[];
  constructor(provider: string, envVars: string[]) {
    super(
      `"${provider}"의 API 키가 없다 — ${envVars.join(" 또는 ")} 를 설정하거나 apiKey를 넘겨라`,
    );
    this.name = "MissingApiKeyError";
    this.provider = provider;
    this.envVars = envVars;
  }
}
