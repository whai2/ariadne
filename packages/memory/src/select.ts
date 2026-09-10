// 선택 기계 — 어느 문장이 쓸모 있는지를 **써보고 정한다** (F4.3). **순수 함수 · LLM 호출 0.**
//
// F4.2까지는 스튜디오가 `level === "preference"`를 손으로 골랐다. 그건 F4.0 실험 결과를
// **코드에 하드코딩**한 것이고, 기계는 아무것도 안 배운 상태였다. 게다가 그 실험은
// **한 과제·한 모델**에서 잰 것이라, 이 에이전트에서도 선호형이 최선인지는 아무도 모른다.
//
// 여기서 그 하드코딩을 걷어낸다. 공고화가 **변이**를 만들고(F4.2), 여기가 **선택**을 한다.
// 무엇이 중요한지를 쓰는 시점에 판단하지 않는다는 이 링의 원칙이 마지막으로 적용되는 자리다.

import { type BaseMessage, isAIMessage, type ToolCall } from "@ariadne/core";
import type { InjectionOutcome, ScoredFact } from "./schema";

/**
 * 이번 턴에 시험할 사실 **하나**를 고른다. 없으면 `undefined`.
 *
 * **하나만 고르는 게 이 함수의 존재 이유다.** 후보 셋을 동시에 주입하면 행동이 바뀌어도
 * 어느 게 바꿨는지 영영 모른다 — **귀속이 안 되는 순간 이건 선택 기계가 아니라 그냥
 * 프롬프트 덧붙이기다.**
 *
 * 순서: **시행 적은 것 → 강도 높은 것 → id.** 첫 항이 라운드로빈을 만든다. 그래야 모든
 * 후보가 공평하게 기회를 받고, 초반에 운 좋게 이긴 후보가 나머지를 굶기지 못한다
 * (탐색과 활용의 가장 값싼 절충이다 — 통계적 밴딧을 들이는 건 이 단계 밖이다).
 */
export function chooseFact(facts: readonly ScoredFact[]): ScoredFact | undefined {
  let best: ScoredFact | undefined;
  for (const f of facts) {
    if (best === undefined) {
      best = f;
      continue;
    }
    if (f.trials !== best.trials) {
      if (f.trials < best.trials) best = f;
      continue;
    }
    if (f.strength !== best.strength) {
      if (f.strength > best.strength) best = f;
      continue;
    }
    if (f.id < best.id) best = f;
  }
  return best;
}

/** 이번 run이 새로 만든 메시지들 안의 툴 호출 전부. */
function callsIn(messages: readonly BaseMessage[]): ToolCall[] {
  return messages.flatMap((m) => (isAIMessage(m) ? (m.toolCalls ?? []) : []));
}

/**
 * 주입 한 번의 결과를 판정한다. **F4.0 실험이 잰 그 행동을 그대로 본다** — 모델이 대상 툴을
 * 그냥 불렀나.
 *
 * **어휘 중첩은 안 쓴다.** 처음 후보였던 "주입한 문장이 답에 겹치면 강화"는 폐기했다:
 * `"write_note를 쓸까요?"`(성공)와 `"write_note 했습니다"`(실패)가 **똑같이 겹친다** —
 * 성공과 실패에 같은 점수를 주는 지표는 지표가 아니다.
 *
 * **`neutral`이 따로 있는 이유:** 툴을 불렀는데 승인 게이트가 멈춰 세웠다면 그건 **게이트의
 * 공이지 기억의 공이 아니다.** 둘을 안 가르면 게이트가 잘 막아준 걸 기억의 성적으로 착각한다.
 *
 * **무관한 턴도 시행으로 센다**(대상 툴을 안 불렀으니 `reinforce`). 날씨를 물은 턴이 공짜로
 * 점수를 주는 셈인데, **라운드로빈이 그 잡음을 후보들에게 균등하게 나눠주므로 순위는 안
 * 흔들린다.** 대신 절대 점수엔 의미가 없다 — 그래서 순위만 쓴다.
 */
export function judge(
  target: string,
  produced: readonly BaseMessage[],
  pending: readonly ToolCall[],
): InjectionOutcome {
  const calledTarget = callsIn(produced).some((c) => c.name === target);
  if (!calledTarget) return "reinforce";
  return pending.length > 0 ? "neutral" : "decay";
}
