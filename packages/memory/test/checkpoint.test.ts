import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/index";

const stores: MemoryStore[] = [];
const dirs: string[] = [];
function open(path?: string, now?: () => number) {
  const store = MemoryStore.open(path, { now });
  stores.push(store);
  return store;
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("thread별 부모 연결과 최신순은 시계가 역행해도 유지된다", () => {
  let clock = 100;
  const store = open(undefined, () => clock--);
  expect(store.getLatest("a")).toBeUndefined();
  expect(store.list("a")).toEqual([]);
  const first = store.putCheckpoint("a", { step: 0, channels: { budget: 5 } });
  const last = store.putCheckpoints("a", [
    { step: 0, channels: { budget: 4 } },
    { step: 1, channels: { budget: 3 } },
  ]);
  store.putCheckpoint("b", { step: 0, channels: { budget: 99 } });
  expect(first).toMatchObject({ checkpoint_id: 1, parent_checkpoint_id: null, checkpoint_ns: "" });
  expect(last).toMatchObject({ checkpoint_id: 3, parent_checkpoint_id: 2, created_at: 98 });
  expect(store.getLatest("a")?.channels).toEqual({ budget: 3 });
  expect(store.getLatest("b")?.checkpoint_id).toBe(1);
  expect(store.list("a").map((row) => row.checkpoint_id)).toEqual([3, 2, 1]);
  expect(store.list("a", 1)).toEqual([last]);
  expect(store.list("a", 0)).toEqual([]);
  expect(() => store.list("a", -1)).toThrow();
  expect(() => store.list("a", 1.5)).toThrow();
});

test("파일을 다시 열어 상태와 부모 연결을 이어간다", () => {
  const dir = mkdtempSync(join(tmpdir(), "ariadne-checkpoint-"));
  dirs.push(dir);
  const path = join(dir, "memory.sqlite");
  const first = MemoryStore.open(path);
  first.putCheckpoint("thread", { step: 0, channels: { plan: "p", budget: 5 } });
  first.close();
  const reopened = open(path);
  expect(reopened.getLatest("thread")?.channels).toEqual({ plan: "p", budget: 5 });
  expect(reopened.putCheckpoint("thread", { step: 0, channels: {} }).parent_checkpoint_id).toBe(1);
});

test("JSON 스냅샷은 입력과 조회 결과의 후속 변경에서 독립적이다", () => {
  const store = open();
  const channels = { plan: { steps: ["a"] }, nothing: null, missing: undefined };
  const saved = store.putCheckpoint("a", { step: 0, channels });
  channels.plan.steps.push("b");
  saved.channels.plan = "changed";
  expect(store.getLatest("a")?.channels).toEqual({ plan: { steps: ["a"] }, nothing: null });
});

test("배치 중 직렬화나 SQL 실패는 앞서 삽입한 스텝도 롤백한다", () => {
  const store = open();
  const original = store.putCheckpoint("a", { step: 0, channels: { budget: 5 } });
  for (const bad of [
    { step: 2, channels: { value: 1n } },
    { step: -1, channels: {} },
  ]) {
    expect(() => store.putCheckpoints("a", [{ step: 1, channels: {} }, bad])).toThrow();
    expect(store.list("a")).toEqual([original]);
  }
  expect(store.putCheckpoint("a", { step: 0, channels: {} }).checkpoint_id).toBe(2);
  expect(() => store.putCheckpoints("a", [])).toThrow();
  expect(() => store.putCheckpoint("", { step: 0, channels: {} })).toThrow();
});
