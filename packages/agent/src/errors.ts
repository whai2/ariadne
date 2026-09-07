// 에이전트 링의 에러.
//
// 하나뿐이다 — 구성 시점의 실수 하나를 **첫 호출이 아니라 만들 때** 잡는다.

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
