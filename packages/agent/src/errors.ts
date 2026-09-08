// 에이전트 링의 에러.
//
// 둘 다 **구성 시점**의 실수다 — 첫 호출이 아니라 그래프를 만드는 순간에 잡는다.
// 둘의 공통점이 이 링의 에러 정책이다: **조용한 오작동을 만드는 설정은 세워둔다.**

/**
 * 툴을 줬는데 모델이 와이어에 툴을 못 싣는다(`supportsTools === false`).
 *
 * **왜 구성 시점에 던지나:** 그냥 두면 `invoke`가 툴 없이 호출돼 모델이 산문으로 답하고,
 * `toolsCondition`이 END를 골라 그래프가 **툴 노드에 영영 안 간다.** 조용한 오작동이다.
 * F2.1이 어댑터 층에서 같은 이유로 던지기로 했고(“조용히 무시하면 그래프가 툴을 안 쓴다”),
 * 에이전트는 그 판단을 **한 걸음 앞으로** 당겨 그래프를 세우는 순간에 막는다.
 *
 * 고치는 법: 네이티브 프로바이더를 쓰거나, claude-code라면 `promptedTools`로 모델을 만든다(F2.4).
 */
export class ModelCannotUseToolsError extends Error {
  constructor(readonly provider: string) {
    super(
      `프로바이더 '${provider}'는 툴 정의를 와이어에 못 싣는다(supportsTools=false). ` +
        `툴 없이 에이전트를 만들거나, 네이티브 프로바이더 또는 claude-code+promptedTools로 모델을 만들어라.`,
    );
    this.name = "ModelCannotUseToolsError";
  }
}

/**
 * 승인 정책을 줬는데 툴이 없다 (F3.3).
 *
 * **왜 구성 시점에 던지나:** 게이트는 툴 노드를 감싼 것이라, 툴이 없으면 그래프에 tools 노드
 * 자체가 안 생기고 정책은 **영영 안 불린다.** 그대로 두면 "승인을 걸었다"고 믿는 에이전트가
 * 아무것도 안 물어보고 도는데, 승인 게이트에서 그건 가장 나쁜 종류의 조용한 오작동이다
 * (안전 장치가 안 걸린 걸 아무도 모른다). `ModelCannotUseToolsError`와 같은 판단이다.
 */
export class ApprovalWithoutToolsError extends Error {
  constructor() {
    super(
      "승인 정책(approval)을 줬는데 툴이 없다 — 게이트가 감쌀 게 없어 정책은 절대 안 불린다. " +
        "툴을 주거나 approval을 빼라.",
    );
    this.name = "ApprovalWithoutToolsError";
  }
}
