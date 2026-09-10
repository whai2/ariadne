// 공고화 — 쌓인 가치 신호를 **문장 후보들**로 바꾼다 (F4.2). **순수 함수 · LLM 호출 0.**
//
// **왜 LLM을 안 쓰나.** 이 단계에서 검증하려는 건 문장의 품질이 아니라 **루프가 도는가**다.
// 규칙 기반이면 값싸고 결정론적이라 테스트가 된다. 생성기는 나중에 통째로 교체할 수 있고,
// 그때 **나머지 기계가 안 바뀌는 것**이 이 설계의 논지다 — 생성기는 부품이고 선택이 프레임워크다.
//
// **왜 후보를 여럿 만드나.** F4.0 실험이 답을 절반만 줬다. 무엇이 먹히는지는 알아냈지만
// (사건 서술은 효과 0, 선호·규칙은 효과 완전) 그건 **한 과제·한 모델**에서다. 어느 수준이
// 이 에이전트에 쓸모 있는지는 지금 모른다 — 그래서 셋 다 만들어 두고, **쓰이는 것이 남는다**.
// 무엇이 중요한지를 쓰는 시점에 판단하지 않는다는 이 링의 원칙이 여기서 두 번째로 적용된다.

import type { FactLevel, ValueEventRow } from "./schema";

/**
 * 공고화 임계치. **1회는 사고일 수 있다** — 실수로 눌렀거나, 그때 그 파일만 싫었거나.
 * 2회부터 패턴으로 본다. (실험도 "거부 2회" 상황을 재현했다.)
 */
export const DENY_THRESHOLD = 2;

/** 아직 id가 없는 사실. 저장 전 형태. */
export interface FactDraft {
  agent: string;
  text: string;
  target: string;
  level: FactLevel;
  origin: string;
}

/**
 * 툴 이름 하나에서 **추상화 수준이 다른 문장 셋**을 만든다.
 *
 * 템플릿이 툴 이름만 쓰는 게 판단이다. "write_file은 파일을 쓴다" 같은 **사람 말 표**를 두면
 * 툴이 늘 때마다 손으로 채워야 하고, 자동화하려면 LLM이 필요하다 — 둘 다 이 커밋 밖이다.
 * 어색해도 이름만으로 만든다.
 */
function candidates(target: string, deny: number, allow: number): Omit<FactDraft, "agent">[] {
  const origin = `deny ${deny} / allow ${allow}`;
  return [
    // 실험 예측: **효과 0.** 사건을 그대로 옮긴 문장은 모델이 무시했다.
    {
      text: `사용자는 ${target} 실행을 거부한 적이 있다 (${deny}회).`,
      target,
      level: "episodic",
      origin,
    },
    {
      text: `사용자는 ${target}이(가) 확인 없이 실행되는 것을 원하지 않는다.`,
      target,
      level: "preference",
      origin,
    },
    {
      text: `${target}을(를) 부르기 전에 무엇을 할지 먼저 설명하고 사용자 확인을 받아라.`,
      target,
      level: "rule",
      origin,
    },
  ];
}

/**
 * 가치 이벤트를 `(agent, target)`으로 집계해, 임계를 넘긴 타깃마다 후보 셋을 낸다.
 *
 * 두 조건을 **둘 다** 넘겨야 한다:
 * - 거부가 {@link DENY_THRESHOLD} 이상 (한 번은 사고일 수 있다)
 * - 거부가 허용보다 많다 (**대개 허용하는 툴이면 그건 선호가 아니다** — 한 번 거부했다고
 *   그 뒤 열 번 승인한 툴을 막으면, 기억이 사람을 돕는 게 아니라 방해한다)
 *
 * `events`는 **이 에이전트 것만** 걸러 넘겨도 되고 전부 넘겨도 된다 — 여기서 다시 거른다.
 */
export function proposeFacts(events: readonly ValueEventRow[], agent: string): FactDraft[] {
  const tally = new Map<string, { deny: number; allow: number }>();
  for (const e of events) {
    if (e.agent !== agent) continue;
    const t = tally.get(e.target) ?? { deny: 0, allow: 0 };
    if (e.kind === "deny") t.deny += 1;
    else t.allow += 1;
    tally.set(e.target, t);
  }

  const drafts: FactDraft[] = [];
  // 이름순으로 낸다 — 삽입 순서가 결정론적이라 테스트와 관찰이 흔들리지 않는다.
  for (const target of [...tally.keys()].sort()) {
    const { deny, allow } = tally.get(target) ?? { deny: 0, allow: 0 };
    if (deny < DENY_THRESHOLD || deny <= allow) continue;
    for (const c of candidates(target, deny, allow)) drafts.push({ agent, ...c });
  }
  return drafts;
}
