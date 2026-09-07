// MCP stdio 클라이언트 — 서버 프로세스를 띄우고 JSON-RPC로 말한다 (F3.2).
//
// **SDK를 안 쓴다.** F1.7에서 `claude` CLI를 SDK 없이 `spawn`으로 부른 것과 같은 판단이다 —
// 우리가 쓰는 표면이 `initialize` · `tools/list` · `tools/call` 셋뿐이라, 그걸 감싼 패키지를
// 들이면 **배우려는 프로토콜이 정확히 그 안에 숨는다.** (HTTP/SSE 트랜스포트와 OAuth가 필요해지면
// 그때는 SDK가 값을 한다 — 거긴 우리가 다시 짤 이유가 없는 분량이다.)
//
// **이 파일은 툴 링을 모른다.** 여기까지가 순수 프로토콜 층이고, `Tool`로 바꾸는 다리는
// tools.ts 하나다. 그래서 이 클라이언트는 나중에 리소스·프롬프트가 필요해져도 제자리에 있다.

import { McpConnectionError, McpProtocolError } from "./errors";
import { asResponse, encodeFrame, splitFrames } from "./protocol";

/**
 * 우리가 말하겠다고 선언하는 스펙 버전.
 *
 * 서버가 **다른 버전을 돌려줘도 끊지 않는다.** 우리가 쓰는 세 메서드는 버전 간에 안 바뀌었고,
 * 여기서 깐깐하게 굴면 멀쩡히 툴을 주는 서버를 거부하게 된다. 실제로 돌려받은 값은
 * `protocolVersion`에 남겨 관찰할 수 있게 둔다.
 */
export const PROTOCOL_VERSION = "2025-06-18";

/** 서버를 어떻게 띄울지. MCP 설정 파일(`mcpServers`)의 한 항목과 같은 모양이다. */
export interface StdioServerConfig {
  command: string;
  args?: readonly string[];
  /** 넘기면 현재 env에 **덮어쓴다**(치환이 아니다 — PATH가 사라지면 command부터 못 찾는다). */
  env?: Record<string, string>;
  cwd?: string;
}

/** 서버가 `tools/list`로 주는 툴 선언 하나. */
export interface McpToolDef {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** `tools/call` 결과의 content 블록. `text` 말고도 image·audio·resource가 온다. */
export interface McpContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content?: McpContentBlock[];
  /** **툴이 실패했다** — 프로토콜 실패가 아니다. 이 구분이 tools.ts의 에러 정책을 가른다. */
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpServerInfo {
  name: string;
  version?: string;
}

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

/** stderr를 무한정 쌓지 않는다 — 말 많은 서버가 메모리를 먹는다. 뒤쪽이 원인에 가깝다. */
const STDERR_KEEP = 8_000;
/** stdin을 닫고 서버가 스스로 나가길 기다리는 시간. 넘으면 kill. */
const CLOSE_GRACE_MS = 2_000;

/**
 * 떠 있는 MCP 서버 하나와의 연결.
 *
 * **이 저장소의 첫 클래스다.** 지금까지 링은 전부 함수였는데(`defineTool`·`model`·`createAgent`),
 * 여기엔 감출 게 진짜로 있다 — 자식 프로세스, 읽다 만 버퍼, 답을 기다리는 요청 표, 그리고
 * **닫아야 하는 수명**. 노트 21이 "가변 상태가 생기면 클래스로 승격"이라고 예고한 자리인데,
 * 실측해 보니 그 상태는 **에이전트가 아니라 여기** 있다 — 그래서 `createAgent`는 함수로 남는다.
 */
export class McpClient {
  #proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #stderr = "";
  #closed = false;
  #failure: McpConnectionError | undefined;
  #serverInfo: McpServerInfo = { name: "(unknown)" };
  #protocolVersion: string = PROTOCOL_VERSION;

  private constructor(proc: Bun.Subprocess<"pipe", "pipe", "pipe">) {
    this.#proc = proc;
  }

  /** 서버가 `initialize`에서 밝힌 이름·버전. 스튜디오가 "무엇에 붙었는지" 보여줄 때 쓴다. */
  get serverInfo(): McpServerInfo {
    return this.#serverInfo;
  }

  /** 서버가 실제로 합의한 스펙 버전(우리가 제안한 것과 다를 수 있다). */
  get protocolVersion(): string {
    return this.#protocolVersion;
  }

  /**
   * 서버를 띄우고 **핸드셰이크까지 끝낸** 클라이언트를 준다.
   *
   * 핸드셰이크는 셋이다: `initialize` 요청 → 서버의 능력 응답 → `notifications/initialized` 통보.
   * 마지막 통보를 빼먹으면 스펙을 엄히 지키는 서버가 이후 요청을 거부한다.
   */
  static async connectStdio(config: StdioServerConfig): Promise<McpClient> {
    let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      proc = Bun.spawn({
        cmd: [config.command, ...(config.args ?? [])],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
        ...(config.env === undefined ? {} : { env: { ...process.env, ...config.env } }),
      });
    } catch (cause) {
      // spawn 자체가 실패하면 stderr조차 없다 — 대개 command 오타다.
      throw new McpConnectionError(
        `MCP 서버를 못 띄웠다: ${config.command} (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }

    // 펌프를 핸드셰이크 **전에** 붙인다 — 안 그러면 첫 응답이 이미 지나간 뒤다.
    const client = new McpClient(proc);
    client.#pumpStdout();
    client.#pumpStderr();
    client.#watchExit();
    await client.#handshake();
    return client;
  }

  /** 요청 하나. 응답이 올 때까지 기다린다. */
  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#closed) throw new McpConnectionError(`연결이 닫힌 뒤에 '${method}'를 불렀다`);

    const id = this.#nextId++;
    const answer = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { method, resolve, reject });
    });
    this.#write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    return (await answer) as T;
  }

  /** 통보 하나. 답이 없으므로 기다리지 않는다. */
  notify(method: string, params?: unknown): void {
    this.#write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  /**
   * 서버의 툴 전부. **커서가 있으면 끝까지 따라간다** — 툴이 많은 서버는 페이지로 나눠 준다.
   * 여기서 안 돌면 모델이 툴의 절반만 보고, 그건 조용한 오작동이다.
   */
  async listTools(): Promise<McpToolDef[]> {
    const all: McpToolDef[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request<{ tools?: unknown; nextCursor?: unknown }>(
        "tools/list",
        cursor === undefined ? {} : { cursor },
      );
      if (!Array.isArray(page.tools)) {
        throw new McpProtocolError("tools/list 응답에 tools 배열이 없다");
      }
      all.push(...(page.tools as McpToolDef[]));
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
    } while (cursor !== undefined);
    return all;
  }

  /** 툴 하나를 부른다. **실행 실패(`isError`)도 정상 응답으로 돌아온다** — 던지지 않는다. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return await this.request<McpToolResult>("tools/call", { name, arguments: args });
  }

  /**
   * 연결을 닫는다. **stdin을 닫는 게 정중한 종료 신호다**(스펙이 정한 순서) — 서버가 그걸 보고
   * 스스로 나간다. 안 나가면 잠깐 기다렸다 죽인다.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#proc.stdin.end();
    } catch {
      // 이미 끊긴 파이프. 닫는 중이므로 알 바 아니다.
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      this.#proc.exited.then(() => "exited" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), CLOSE_GRACE_MS);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (outcome === "timeout") this.#proc.kill();
    this.#failAllPending(
      new McpConnectionError("연결을 닫는 중에 요청이 남아 있었다", this.#stderr),
    );
  }

  async #handshake(): Promise<void> {
    const result = await this.request<{ serverInfo?: McpServerInfo; protocolVersion?: string }>(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        // 능력을 하나도 선언 안 한다 — 우리는 서버의 툴을 쓸 뿐, 역방향 요청(샘플링·루트·
        // elicitation)을 받을 생각이 없다. 안 되는 걸 된다고 말하면 서버가 그걸 부른다.
        capabilities: {},
        clientInfo: { name: "ariadne", version: "0.0.0" },
      },
    );
    // 서버가 "이제 말해도 된다"를 기다린다. 이 통보가 핸드셰이크의 마지막 한 걸음이다.
    this.notify("notifications/initialized");
    if (result.serverInfo !== undefined) this.#serverInfo = result.serverInfo;
    if (result.protocolVersion !== undefined) this.#protocolVersion = result.protocolVersion;
  }

  #write(message: unknown): void {
    try {
      this.#proc.stdin.write(encodeFrame(message));
      this.#proc.stdin.flush();
    } catch (cause) {
      throw new McpConnectionError(
        `MCP 서버에 쓰지 못했다: ${cause instanceof Error ? cause.message : String(cause)}`,
        this.#stderr,
      );
    }
  }

  /** stdout을 계속 읽어 프레임을 응답 표에 나눠준다. 연결 내내 도는 유일한 루프. */
  #pumpStdout(): void {
    void (async () => {
      const reader = this.#proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = splitFrames(buffer);
          buffer = rest;
          for (const frame of frames) this.#dispatch(frame);
        }
      } catch {
        // 프로세스가 죽으면 읽기가 터진다. 실제 처리는 #watchExit이 한다(원인이 stderr에 있다).
      }
    })();
  }

  #pumpStderr(): void {
    void (async () => {
      const reader = this.#proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.#stderr = (this.#stderr + decoder.decode(value, { stream: true })).slice(
            -STDERR_KEEP,
          );
        }
      } catch {
        // stderr를 못 읽는 건 그 자체로 보고할 일이 아니다.
      }
    })();
  }

  /**
   * 서버가 죽으면 **기다리던 요청을 전부 깨운다.**
   *
   * 이게 없으면 서버 크래시가 조용한 hang이 된다 — 응답이 영영 안 오고, 테스트는 타임아웃까지
   * 매달린다. 프로세스 종료는 이 링에서 가장 흔한 실패 모드라, 그걸 **에러로 바꿔주는 자리**가
   * 반드시 있어야 한다.
   */
  #watchExit(): void {
    void this.#proc.exited.then((code) => {
      if (this.#closed) return; // 우리가 닫은 것
      this.#failure = new McpConnectionError(
        `MCP 서버가 먼저 종료됐다 (exit ${code})`,
        this.#stderr,
      );
      this.#failAllPending(this.#failure);
    });
  }

  #failAllPending(error: Error): void {
    for (const [, waiter] of this.#pending) waiter.reject(error);
    this.#pending.clear();
  }

  #dispatch(frame: string): void {
    const response = asResponse(frame);
    if (response === undefined) return; // 알림·역방향 요청·서버가 stdout에 흘린 로그
    // 문자열 id로 돌려주는 서버가 있다. 숫자로 맞춰본다(우리 id는 항상 숫자다).
    const id = typeof response.id === "number" ? response.id : Number(response.id);
    const waiter = this.#pending.get(id);
    if (waiter === undefined) return; // 이미 처리했거나 우리 것이 아닌 id
    this.#pending.delete(id);
    if (response.error !== undefined) {
      waiter.reject(
        new McpProtocolError(
          `MCP 서버가 '${waiter.method}'에 에러를 돌려줬다: ${response.error.message}`,
          response.error.code,
        ),
      );
      return;
    }
    waiter.resolve(response.result);
  }
}

/** `McpClient.connectStdio`의 함수 얼굴. 다른 링들과 호출 모양을 맞춘다. */
export function connectStdio(config: StdioServerConfig): Promise<McpClient> {
  return McpClient.connectStdio(config);
}
