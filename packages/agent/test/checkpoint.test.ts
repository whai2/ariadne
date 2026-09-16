import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { END, isToolMessage, type MessagesState, START, StateGraph } from "@ariadne/core";
import { MemoryStore } from "@ariadne/memory";
import { runWithCheckpoint } from "../src/index";

interface Result {
  state: MessagesState & { plan: string; budget: number };
  ran: string[];
  order: string[];
  pending: unknown[];
}
const fixture = join(import.meta.dir, "fixtures/persistent-turn.ts");

for (const decision of ["allow", "deny"] as const) {
  test(`저장 직후 강제 종료 → 이력 없이 ${decision} 재개`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ariadne-resume-"));
    const path = join(dir, "memory.sqlite");
    const threadId = "thread-1";
    const paused = Bun.spawn(
      [process.execPath, fixture, JSON.stringify({ path, threadId, hold: true })],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    try {
      const reader = paused.stdout.getReader();
      let output = "";
      const decoder = new TextDecoder();
      while (!output.includes("\n")) {
        const part = await reader.read();
        if (part.done)
          throw new Error(`저장 전에 종료: ${await new Response(paused.stderr).text()}`);
        output += decoder.decode(part.value, { stream: true });
      }
      reader.releaseLock();
      const first = JSON.parse(output) as Result;
      expect(first.pending).toHaveLength(1);
      expect(first.ran).toEqual([]);
      paused.kill("SIGKILL");
      await paused.exited;

      async function resume(): Promise<Result> {
        // 앞 프로세스의 이력/plan/budget을 넘기지 않는다. 공유하는 것은 DB와 threadId뿐이다.
        const child = Bun.spawn(
          [process.execPath, fixture, JSON.stringify({ path, threadId, decision })],
          {
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [out, err, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (code !== 0) throw new Error(err);
        return JSON.parse(out) as Result;
      }
      const second = await resume();
      expect(second.state.plan).toBe("delete a.txt");
      expect(second.state.budget).toBe(5);
      expect(second.state.messages).toHaveLength(first.state.messages.length + 2);
      expect(second.state.messages.filter(isToolMessage)).toHaveLength(1);
      expect(second.pending).toEqual([]);
      expect(second.ran).toEqual(decision === "allow" ? ["a.txt"] : []);
      expect(second.order).toEqual(decision === "allow" ? ["tool", "model"] : ["model"]);
      const third = await resume();
      expect(third.ran).toEqual([]);
      expect(third.state.messages.filter(isToolMessage)).toHaveLength(1);
    } finally {
      paused.kill();
      await paused.exited;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

function counter(fail = false) {
  const graph = new StateGraph<{ budget: number }>({ budget: { reducer: (a, b) => a + b } });
  graph.addNode("first", () => ({ budget: 1 }));
  graph.addNode("second", () => {
    if (fail) throw new Error("node failed");
    return { budget: 1 };
  });
  graph.addEdge(START, "first");
  graph.addEdge("first", "second");
  graph.addEdge("second", END);
  return graph.compile();
}

test("복원은 리듀서를 우회하고 이번 입력만 더한다; thread 상태는 섞이지 않는다", async () => {
  const store = MemoryStore.open();
  try {
    expect(await runWithCheckpoint(counter(), "a", { budget: 5 }, store)).toEqual({ budget: 7 });
    expect(await runWithCheckpoint(counter(), "a", { budget: -1 }, store)).toEqual({ budget: 8 });
    expect(await runWithCheckpoint(counter(), "b", { budget: 20 }, store)).toEqual({ budget: 22 });
    expect(store.list("a").map((c) => [c.step, c.channels.budget])).toEqual([
      [1, 8],
      [0, 7],
      [1, 7],
      [0, 6],
    ]);
  } finally {
    store.close();
  }
});

test("실패한 run의 중간 스텝은 최신 정지점을 덮어쓰지 않는다", async () => {
  const store = MemoryStore.open();
  try {
    await runWithCheckpoint(counter(), "a", { budget: 5 }, store);
    const before = store.list("a");
    await expect(runWithCheckpoint(counter(true), "a", {}, store)).rejects.toThrow("node failed");
    expect(store.list("a")).toEqual(before);
    await expect(runWithCheckpoint(counter(true), "new", { budget: 5 }, store)).rejects.toThrow();
    expect(store.list("new")).toEqual([]);
  } finally {
    store.close();
  }
});

test("0스텝 그래프와 빈 threadId는 저장 없이 거부한다", async () => {
  const store = MemoryStore.open();
  const graph = new StateGraph<{ budget: number }>({ budget: {} });
  graph.addEdge(START, END);
  try {
    await expect(runWithCheckpoint(graph.compile(), "a", { budget: 5 }, store)).rejects.toThrow(
      "최소 한 스텝",
    );
    await expect(runWithCheckpoint(counter(), "", { budget: 5 }, store)).rejects.toThrow(
      "threadId",
    );
    expect(store.list("a")).toEqual([]);
  } finally {
    store.close();
  }
});

test("후속 스텝이 객체를 변경해도 앞 스텝의 저장값은 바뀌지 않는다", async () => {
  const graph = new StateGraph<{ values: string[] }>({
    values: {
      reducer: (a, b) => {
        a.push(...b);
        return a;
      },
    },
  });
  graph.addNode("first", () => ({ values: ["a"] }));
  graph.addNode("second", () => ({ values: ["b"] }));
  graph.addEdge(START, "first");
  graph.addEdge("first", "second");
  graph.addEdge("second", END);
  const store = MemoryStore.open();
  try {
    await runWithCheckpoint(graph.compile(), "a", { values: [] }, store);
    expect(store.list("a").map((c) => c.channels.values)).toEqual([["a", "b"], ["a"]]);
  } finally {
    store.close();
  }
});

test("스냅샷 직렬화나 저장 실패를 성공으로 반환하지 않는다", async () => {
  const graph = new StateGraph<{ value: bigint }>({ value: {} });
  graph.addNode("first", () => ({ value: 1n }));
  graph.addEdge(START, "first");
  graph.addEdge("first", END);
  const store = MemoryStore.open();
  try {
    await expect(runWithCheckpoint(graph.compile(), "a", {}, store)).rejects.toThrow();
    expect(store.list("a")).toEqual([]);
    await expect(
      runWithCheckpoint(
        counter(),
        "a",
        { budget: 5 },
        {
          getLatest: () => undefined,
          putCheckpoints: () => {
            throw new Error("disk full");
          },
        },
      ),
    ).rejects.toThrow("disk full");
  } finally {
    store.close();
  }
});
