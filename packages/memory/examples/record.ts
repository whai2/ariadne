// 메모리 링 데모 — **자격증명 0, 네트워크 0, 파일 0**(`:memory:`).
//
//   bun run --filter '@ariadne/memory' example
//
// 볼 것은 하나다: **내용과 가치가 다른 테이블로 흐른다.**
// 세 턴을 손으로 재현한다 — 스튜디오에서 승인 게이트를 두 번 거부하고 한 번 허용한 모양이다.
//
// 이 단계에선 아무도 이걸 안 읽는다. 재료를 쌓는 데까지다.

import { ai, human, tool as toolMessage } from "@ariadne/core";
import { MemoryStore } from "../src/index";

let clock = 1_700_000_000_000;
const memory = MemoryStore.open(":memory:", { now: () => (clock += 1000) });

const AGENT = "filesystem";
const call = { id: "c1", name: "write_file", args: { path: "notes.md" } };

/** 승인 대기로 멈춘 턴. 새 메시지는 툴 호출 실린 AI 하나뿐이다. */
function pausedTurn(historyLen: number): number {
  const id = memory.beginEpisode(
    AGENT,
    Array.from({ length: historyLen }, () => human("…")),
  );
  memory.endEpisode(id, [ai("", undefined, [call])], "paused");
  return id;
}

// ── 1턴: 요청 → 멈춤 → 사람이 거부 ──
const t1 = pausedTurn(1);
memory.recordValueEvent(t1, AGENT, "deny", ["write_file"]);

// ── 2턴: 다시 요청 → 멈춤 → 또 거부 ──
const t2 = pausedTurn(3);
memory.recordValueEvent(t2, AGENT, "deny", ["write_file"]);

// ── 3턴: 이번엔 허용 → 툴이 돌고 run이 끝까지 간다 ──
//    **재개는 새 에피소드다** — 서버가 무상태라 앞 턴과 잇는 키가 없고, 이을 이유도 아직 없다.
const t3 = memory.beginEpisode(AGENT, [human("…"), ai("", undefined, [call])]);
memory.recordValueEvent(t3, AGENT, "allow", ["write_file"]);
memory.endEpisode(t3, [toolMessage("c1", "wrote notes.md"), ai("저장했다.")], "completed");

// ── 관찰 ──
console.log("━━━ 에피소드 (겪은 일) ━━━");
for (const e of memory.episodes(AGENT).reverse()) {
  const produced = JSON.parse(e.messages) as { role: string }[];
  console.log(
    `  #${e.id}  ${e.status.padEnd(9)}  들어온 이력 ${e.input_count}개 → 새 메시지 ${produced.length}개  [${produced.map((m) => m.role).join(", ")}]`,
  );
}

console.log("\n━━━ 가치 이벤트 (사람이 내린 결정) ━━━");
for (const v of memory.valueEvents(AGENT).reverse()) {
  console.log(`  #${v.episode_id}  ${v.kind.padEnd(5)}  ${v.target}`);
}

// 여기가 다음 단계의 입력이다. 이 카운트에서 사실 후보가 나온다.
const denies = memory.valueEvents(AGENT).filter((v) => v.kind === "deny").length;
console.log(
  `\n  → write_file 거부 ${denies}회 · 허용 ${memory.valueEvents(AGENT).length - denies}회`,
);
console.log("  → 아직 아무도 이걸 안 읽는다. 재료를 쌓는 데까지가 이 단계다.");

memory.close();
