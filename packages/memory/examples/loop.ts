// 메모리 루프 데모 — **자격증명 0, 네트워크 0, 파일 0.** (F4.2)
//
//   bun run --filter '@ariadne/memory' example:loop
//
// 거부 두 번 → 공고화 → 주입. 세 단계가 한 화면에 들어온다.
//
// **모델은 안 부른다.** 여기서 볼 건 "문장이 얼마나 좋은가"가 아니라 **가치 신호가 문장이 되는
// 경로**라서, 모델을 넣으면 오히려 관찰이 흔들린다. 문장이 실제로 행동을 바꾸는지는 F4.0
// 실험(N=6)이 이미 쟀고, 스튜디오 테스트가 진짜 모델로 다시 잰다.

import { ai, human, tool as toolMessage } from "@ariadne/core";
import { chooseFact, judge, MemoryStore, proposeFacts } from "../src/index";

let clock = 1_700_000_000_000;
const memory = MemoryStore.open(":memory:", { now: () => (clock += 1000) });

const AGENT = "filesystem";
const call = { id: "c1", name: "write_file", args: { path: "notes.md" } };

/** 요청 → 승인 대기로 멈춤 → 사람이 거부. 한 번의 왕복. */
function denyOnce(): void {
  const paused = memory.beginEpisode(AGENT, [human("notes.md에 써줘")]);
  memory.endEpisode(paused, [ai("", undefined, [call])], "paused");

  const resumed = memory.beginEpisode(AGENT, [human("notes.md에 써줘"), ai("", undefined, [call])]);
  memory.recordValueEvent(resumed, AGENT, "deny", ["write_file"]);
  memory.endEpisode(resumed, [ai("알겠다, 안 쓰겠다.")], "completed");
}

console.log("━━━ 1회 거부 후 ━━━");
denyOnce();
console.log(`  공고화 → 새 사실 ${memory.consolidate(AGENT)}개`);
console.log("  → 한 번은 사고일 수 있다. 임계는 2회다.\n");

console.log("━━━ 2회 거부 후 ━━━");
denyOnce();
console.log(`  공고화 → 새 사실 ${memory.consolidate(AGENT)}개\n`);

for (const f of memory.facts(AGENT)) {
  console.log(`    [${f.level.padEnd(10)}] ${f.text}`);
}
console.log(`\n  셋 다 시행 0이다. **어느 게 쓸모 있는지 아직 아무도 모른다.**`);

console.log("\n━━━ 선택 기계가 도는 12턴 ━━━");
// 매 턴 하나만 시험한다. 사건형이면 모델이 그냥 부르고, 아니면 먼저 묻는다 —
// 그게 F4.0 실험의 실측이다(여기선 재현일 뿐, 증거는 그 실험과 스튜디오 테스트다).
for (let turn = 1; turn <= 12; turn++) {
  const fact = chooseFact(memory.scoredFacts(AGENT));
  if (fact === undefined) break;
  const ep = memory.beginEpisode(AGENT, []);
  const inj = memory.beginInjection(fact.id, ep);
  const produced =
    fact.level === "episodic"
      ? [ai("", undefined, [call]), toolMessage("c1", "wrote notes.md")]
      : [ai("쓸까요?")];
  const outcome = judge(fact.target, produced, []);
  memory.endInjection(inj, outcome);
  memory.endEpisode(ep, produced, "completed");
  const icon = outcome === "reinforce" ? "＋" : outcome === "decay" ? "－" : "＝";
  console.log(`  ${String(turn).padStart(2)}턴  ${icon}  [${fact.level}] \uc744 \uc2dc\ud5d8`);
}

console.log("\n━━━ 성적표 ━━━");
for (const f of [...memory.scoredFacts(AGENT)].sort((a, b) => b.strength - a.strength)) {
  const bar = f.strength >= 0 ? "█".repeat(f.strength) : "░".repeat(-f.strength);
  console.log(
    `  [${f.level.padEnd(10)}] 시행 ${f.trials}  강도 ${String(f.strength).padStart(3)}  ${bar}`,
  );
}
console.log("\n  → **사건형이 꼴찌다.** 아무도 안 알려줬는데 기계가 알아냈다.");
console.log("     라운드로빈이라 셋 다 같은 횟수만큼 기회를 받았다 — 그래야 귀속이 된다.");

console.log("\n━━━ 다음 턴의 system ━━━");
const injected = chooseFact(memory.scoredFacts(AGENT));
const block = ["[기억한 것]", `- ${injected?.text ?? ""}`].join("\n");
console.log(["너는 파일 비서다. 답은 간결하게 한국어로.", block].join("\n\n"));

console.log("\n━━━ 허용이 쌓이면 ━━━");
// **대개 허용하는 툴이면 그건 선호가 아니다.** 기억이 사람을 돕는 게 아니라 방해하는 걸 막는다.
const ep = memory.beginEpisode(AGENT, []);
memory.recordValueEvent(ep, AGENT, "allow", ["write_file"]);
memory.recordValueEvent(ep, AGENT, "allow", ["write_file"]);
memory.endEpisode(ep, [], "completed");
const events = memory.valueEvents(AGENT, 1000);
console.log(
  `  deny 2 / allow 2 → 새 후보 ${proposeFacts(events, AGENT).length}개 (거부가 허용보다 많아야 한다)`,
);
console.log("  이미 만들어진 사실은 그대로 남는다 — 도태된 것도 안 지운다(왜 졌는지가 근거다).");

memory.close();
