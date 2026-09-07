// 클라이언트 테스트 — **진짜 프로세스를 띄운다.** 가짜 클라이언트를 상대로 테스트하면
// 우리가 상상한 서버만 통과하므로, fixtures/demo-server.ts를 spawn해 프레이밍·핸드셰이크·
// 종료까지 전부 실제로 일어나게 둔다. 네트워크 0.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectStdio, type McpClient } from "../src/client";
import { McpConnectionError, McpProtocolError } from "../src/errors";

const DEMO = `${import.meta.dir}/fixtures/demo-server.ts`;
const CRASH = `${import.meta.dir}/fixtures/crash-server.ts`;

function spawnDemo(env?: Record<string, string>): Promise<McpClient> {
  return connectStdio({
    command: process.execPath,
    args: [DEMO],
    ...(env === undefined ? {} : { env }),
  });
}

describe("핸드셰이크", () => {
  let client: McpClient;
  beforeAll(async () => {
    client = await spawnDemo();
  });
  afterAll(async () => {
    await client.close();
  });

  test("서버가 자기를 밝힌다", () => {
    expect(client.serverInfo.name).toBe("ariadne-demo");
    expect(client.protocolVersion).toBe("2025-06-18");
  });

  test("tools/list가 선언 그대로 온다", async () => {
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "divide"]);
    expect(tools[0]?.inputSchema.required).toEqual(["text"]);
  });

  test("tools/call 왕복", async () => {
    const result = await client.callTool("echo", { text: "안녕", upper: false });
    expect(result.content?.[0]).toEqual({ type: "text", text: "안녕" });
    expect(result.isError).toBeUndefined();
  });

  test("툴 실패는 정상 응답으로 온다 — 던지지 않는다", async () => {
    const result = await client.callTool("divide", { a: 1, b: 0 });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]).toMatchObject({ text: "0으로 나눌 수 없다" });
  });

  test("JSON-RPC 에러는 던진다 — 그건 프로토콜 실패다", async () => {
    expect(client.callTool("nope", {})).rejects.toThrow(McpProtocolError);
  });

  test("요청 여럿을 동시에 보내도 id로 제자리에 꽂힌다", async () => {
    const [a, b, c] = await Promise.all([
      client.callTool("echo", { text: "1" }),
      client.callTool("echo", { text: "2" }),
      client.callTool("divide", { a: 9, b: 3 }),
    ]);
    expect(a.content?.[0]).toMatchObject({ text: "1" });
    expect(b.content?.[0]).toMatchObject({ text: "2" });
    expect(c.content?.[0]).toMatchObject({ text: "3" });
  });
});

describe("페이지네이션", () => {
  test("커서를 끝까지 따라가 툴을 다 모은다", async () => {
    const client = await spawnDemo({ MCP_FIXTURE_PAGINATE: "1" });
    try {
      // 한 페이지에 하나씩 오는데도 둘 다 나와야 한다 — 안 그러면 모델이 툴의 절반만 본다.
      expect((await client.listTools()).map((t) => t.name)).toEqual(["echo", "divide"]);
    } finally {
      await client.close();
    }
  });
});

describe("실패 모드", () => {
  test("서버가 안 뜨면 stderr를 실은 에러로 깨어난다 (매달리지 않는다)", async () => {
    const attempt = connectStdio({ command: process.execPath, args: [CRASH] });
    expect(attempt).rejects.toThrow(McpConnectionError);
    // 진짜 원인은 stderr에 있다 — 안 실어주면 "서버가 죽었다"만 남는다.
    expect(attempt).rejects.toThrow(/API_TOKEN이 없다/);
  });

  test("없는 실행 파일도 같은 에러로", async () => {
    expect(connectStdio({ command: "/definitely/not/a/real/binary", args: [] })).rejects.toThrow(
      McpConnectionError,
    );
  });

  test("닫은 뒤 요청하면 던진다", async () => {
    const client = await spawnDemo();
    await client.close();
    expect(client.callTool("echo", { text: "x" })).rejects.toThrow(McpConnectionError);
  });

  test("close는 두 번 불러도 안전하다", async () => {
    const client = await spawnDemo();
    await client.close();
    await client.close();
  });
});
