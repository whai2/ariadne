// 실행: bun run --filter '@ariadne/agent' example:persistent
// 네트워크 없이 파일 DB를 닫았다 열어 승인 대기를 재개한다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ai, human, isToolMessage } from "@ariadne/core";
import { MemoryStore } from "@ariadne/memory";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { type Approval, createAgent, pendingToolCalls, runWithCheckpoint } from "../src/index";

function agent(decision: Approval) {
  return createAgent({
    approval: () => decision,
    model: {
      provider: "fake",
      modelId: "demo",
      supportsTools: true,
      async invoke(messages) {
        return messages.some(isToolMessage)
          ? ai("작업 완료")
          : ai("", undefined, [{ id: "call-1", name: "echo", args: { text: "hello" } }]);
      },
    },
    tools: [
      defineTool({
        name: "echo",
        description: "받은 문자열 반환",
        schema: z.object({ text: z.string() }),
        execute: ({ text }) => text,
      }),
    ],
  });
}
const dir = mkdtempSync(join(tmpdir(), "ariadne-persistent-"));
const path = join(dir, "memory.sqlite");
let store = MemoryStore.open(path);
try {
  const paused = await runWithCheckpoint(
    agent("ask"),
    "demo",
    { messages: [human("hello를 출력해")] },
    store,
  );
  console.log("승인 대기:", pendingToolCalls(paused.messages));
  store.close();
  store = MemoryStore.open(path);
  const resumed = await runWithCheckpoint(agent("allow"), "demo", {}, store);
  console.log("복원 후:", resumed.messages);
  console.log("저장한 스텝:", store.list("demo").length);
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
