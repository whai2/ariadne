import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@ariadne/memory";
import type { AgentReply, ThreadView } from "../src/services/types";
import { createStudio, type Studio } from "../src/studio";
import { setup } from "./fixtures/thread-agent";

const stores: MemoryStore[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(s: Studio, path: string, body?: unknown) {
  return s.fetch(
    new Request(
      `http://x${path}`,
      body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
    ),
  );
}
async function create(s: Studio): Promise<ThreadView> {
  const res = await request(s, "/api/threads", { agentId: "fake" });
  expect(res.status).toBe(201);
  return (await res.json()) as ThreadView;
}
async function send(s: Studio, id: string, body: unknown) {
  const res = await request(s, `/api/threads/${id}/messages`, body);
  expect(res.status).toBe(200);
  return (await res.json()) as AgentReply & { thread: ThreadView };
}
async function firstNode(s: Studio, id: string): Promise<string | undefined> {
  const traces = (await (await request(s, `/api/threads/${id}/traces`)).json()) as Array<{
    spans: Array<{ kind: string; name: string }>;
  }>;
  return traces[0]?.spans.find((span) => span.kind === "node")?.name;
}

for (const decision of ["allow", "deny"] as const) {
  test(`새 서버에서 승인 대기를 조회하고 ${decision} 결정만으로 재개한다`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ariadne-threads-"));
    dirs.push(dir);
    const path = join(dir, "memory.sqlite");
    const first = setup();
    const db = MemoryStore.open(path);
    const studio = createStudio(db, first.options);
    const thread = await create(studio);
    expect(thread.messages).toEqual([]);
    expect(thread.state).toEqual({});
    const paused = await send(studio, thread.id, { message: "저장해" });
    expect(paused.thread.pending).toHaveLength(1);
    expect(paused.thread.state.budget).toBe(4);
    expect(first.ran).toEqual([]);
    db.close();

    const reopened = MemoryStore.open(path);
    stores.push(reopened);
    const second = setup();
    const restarted = createStudio(reopened, second.options);
    const restored = await (await request(restarted, `/api/threads/${thread.id}`)).json();
    expect(restored).toEqual(paused.thread);
    const reply = await send(restarted, thread.id, { decision });
    expect(await firstNode(restarted, thread.id)).toBe("tools");
    expect(reply.thread.pending).toEqual([]);
    expect(reply.thread.state.budget).toBe(3);
    expect(reply.thread.messages).toHaveLength(4);
    expect(reply.messages).toHaveLength(2);
    expect(second.ran).toEqual(decision === "allow" ? ["saved"] : []);
    expect(
      (await request(restarted, `/api/threads/${thread.id}/messages`, { decision })).status,
    ).toBe(400);
    expect(reopened.valueEvents("fake").map((row) => row.kind)).toEqual([decision]);
    expect(reopened.episodes("fake")).toHaveLength(2);
    const fresh = await create(restarted);
    expect(fresh.id).not.toBe(thread.id);
    expect(fresh.messages).toEqual([]);
  });
}

test("클라이언트 상태 위조, 잘못된 승인, 대기 중 새 메시지를 거절한다", async () => {
  const db = MemoryStore.open();
  stores.push(db);
  const fixture = setup();
  const s = createStudio(db, fixture.options);
  const thread = await create(s);
  for (const input of [
    {},
    { message: " " },
    { message: 2 },
    { decision: "ask" },
    { decision: "allow" },
    { message: "x", decision: "allow" },
    { message: "x", checkpoint: {} },
    { messages: [] },
    { message: "x", agentId: "other" },
  ]) {
    expect((await request(s, `/api/threads/${thread.id}/messages`, input)).status).toBe(400);
  }
  expect(db.getLatest(thread.id)).toBeUndefined();
  await send(s, thread.id, { message: "저장" });
  expect((await request(s, `/api/threads/${thread.id}/messages`, { message: "다음" })).status).toBe(
    400,
  );
  expect(fixture.ran).toEqual([]);
  const def = fixture.options.definitions?.[0];
  if (!def) throw new Error("fixture definition missing");
  def.approval = [];
  expect(
    (await request(s, `/api/threads/${thread.id}/messages`, { decision: "deny" })).status,
  ).toBe(400);
  def.approval = ["write"];
  def.tools = [];
  expect(
    (await request(s, `/api/threads/${thread.id}/messages`, { decision: "allow" })).status,
  ).toBe(400);
  expect(fixture.ran).toEqual([]);
  expect((await request(s, "/api/threads/nope")).status).toBe(404);
  expect((await request(s, "/api/threads/nope/messages", { message: "x" })).status).toBe(404);
  expect((await request(s, "/api/threads", { agentId: "nope" })).status).toBe(404);
  expect((await request(s, "/api/threads", [])).status).toBe(400);
  expect(
    (await s.fetch(new Request("http://x/api/threads", { method: "POST", body: "{" }))).status,
  ).toBe(400);
  expect((await request(s, "/api/threads/%ZZ")).status).toBe(400);
});

test("실패한 요청은 기존 thread 상태를 바꾸지 않으며 다른 thread와 격리된다", async () => {
  const db = MemoryStore.open();
  stores.push(db);
  const fixture = setup();
  const s = createStudio(db, fixture.options);
  const a = await create(s);
  const b = await create(s);
  const paused = await send(s, a.id, { message: "a" });
  fixture.setFail(true);
  expect((await request(s, `/api/threads/${a.id}/messages`, { decision: "deny" })).status).toBe(
    500,
  );
  expect(await (await request(s, `/api/threads/${a.id}`)).json()).toEqual(paused.thread);
  expect(await (await request(s, `/api/threads/${b.id}`)).json()).toEqual(b);
  fixture.setFail(false);
  await send(s, a.id, { decision: "deny" });
  const second = await send(s, b.id, { message: "b" });
  expect(second.thread.state.budget).toBe(4);
  const failedTraces = (await (await request(s, `/api/threads/${a.id}/traces`)).json()) as Array<{
    status: string;
  }>;
  expect(failedTraces.some((trace) => trace.status === "error")).toBe(true);
  expect((await request(s, `/api/threads/${b.id}/traces`)).status).toBe(200);
});

test("성공·승인 대기·재개 run을 thread별 span 트리로 조회한다", async () => {
  const db = MemoryStore.open();
  stores.push(db);
  const fixture = setup();
  const s = createStudio(db, fixture.options);
  const thread = await create(s);
  expect(await (await request(s, `/api/threads/${thread.id}/traces`)).json()).toEqual([]);
  await send(s, thread.id, { message: "저장" });
  await send(s, thread.id, { decision: "deny" });
  const traces = (await (await request(s, `/api/threads/${thread.id}/traces`)).json()) as Array<{
    status: string;
    spans: Array<{ kind: string; status: string }>;
  }>;
  expect(traces).toHaveLength(2);
  expect(traces.every((trace) => trace.status === "ok")).toBe(true);
  expect(traces.every((trace) => trace.spans.some((span) => span.kind === "model"))).toBe(true);
  expect(traces.flatMap((trace) => trace.spans).every((span) => span.status !== "running")).toBe(
    true,
  );
  expect((await request(s, "/api/threads/nope/traces")).status).toBe(404);
});

test("HTTP 서버 프로세스 강제 종료 후 같은 DB로 thread와 승인 상태를 복구한다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ariadne-http-restart-"));
  dirs.push(dir);
  const path = join(dir, "memory.sqlite");
  async function boot() {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "fixtures/thread-server.ts"),
        path,
        `${path}.traces`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const reader = child.stdout.getReader();
    let output = "";
    try {
      while (!output.includes("\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(await new Response(child.stderr).text());
        output += new TextDecoder().decode(chunk.value);
      }
    } catch (e) {
      child.kill();
      await child.exited;
      throw e;
    } finally {
      reader.releaseLock();
    }
    return { child, url: output.trim() };
  }
  const first = await boot();
  let id: string;
  let paused: ThreadView;
  try {
    const created = await fetch(`${first.url}api/threads`, {
      method: "POST",
      body: JSON.stringify({ agentId: "fake" }),
    });
    id = ((await created.json()) as ThreadView).id;
    const response = await fetch(`${first.url}api/threads/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "저장" }),
    });
    paused = ((await response.json()) as { thread: ThreadView }).thread;
    expect(paused.pending).toHaveLength(1);
  } finally {
    first.child.kill("SIGKILL");
    await first.child.exited;
  }
  const second = await boot();
  try {
    expect(await (await fetch(`${second.url}api/threads/${id}`)).json()).toEqual(paused);
    const resumed = await fetch(`${second.url}api/threads/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ decision: "allow" }),
    });
    expect(resumed.status).toBe(200);
    const reply = (await resumed.json()) as { thread: ThreadView };
    expect(reply.thread.pending).toEqual([]);
    expect(reply.thread.state.budget).toBe(3);
    const traces = (await (
      await fetch(`${second.url}api/threads/${id}/traces`)
    ).json()) as unknown[];
    expect(traces).toHaveLength(2);
  } finally {
    second.child.kill();
    await second.child.exited;
  }
});
