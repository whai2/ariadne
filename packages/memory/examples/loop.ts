// 메모리 루프 데모 — **자격증명 0, 네트워크 0, 파일 0.** (F4.2)
//
//   bun run --filter '@ariadne/memory' example:loop
//
// 거부 두 번 → 공고화 → 주입. 세 단계가 한 화면에 들어온다.
//
// **모델은 안 부른다.** 여기서 볼 건 "문장이 얼마나 좋은가"가 아니라 **가치 신호가 문장이 되는
// 경로**라서, 모델을 넣으면 오히려 관찰이 흔들린다. 문장이 실제로 행동을 바꾸는지는 F4.0
// 실험(N=6)이 이미 쟀고, 스튜디오 테스트가 진짜 모델로 다시 잰다.

import { ai, human } from "@ariadne/core";
import { MemoryStore, proposeFacts } from "../src/index";

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
  const mark = f.level === "preference" ? "▶" : " ";
  console.log(`  ${mark} [${f.level.padEnd(10)}] ${f.text}`);
}
console.log(`\n  ▶ = 스튜디오가 지금 주입하는 것. 나머지 둘은 만들어만 두고 안 쓴다.`);
console.log(`     어느 게 쓸모 있는지는 아직 기계가 모른다 — 실험 결과를 코드에 박아뒀을 뿐이다.`);

console.log("\n━━━ 다음 턴의 system ━━━");
const injected = memory.facts(AGENT).filter((f) => f.level === "preference");
const block = ["[기억한 것]", ...injected.map((f) => `- ${f.text}`)].join("\n");
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
console.log("  이미 만들어진 사실은 그대로 남는다 — 지우는 건 선택 기계의 몫이다(F4.3).");

memory.close();
