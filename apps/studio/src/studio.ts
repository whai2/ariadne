import type { BaseMessage } from "@ariadne/core";
import type { MemoryStore } from "@ariadne/memory";
import { agentInfo, agents, agentTurn, buildAgentGraph } from "./agents";

const DIST_DIR = `${import.meta.dir}/../dist`;

const DEV_PLACEHOLDER = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<title>Ariadne Studio</title></head><body style="font:14px system-ui;background:#0d0d0f;color:#e9e9ec;padding:40px">
<h1>Ariadne Studio</h1><p>UI가 아직 빌드되지 않았다. <code>bun run studio</code>(vite build + 서버) 또는
개발 중이면 <code>bun run --filter '@ariadne/studio' dev:ui</code>(Vite HMR).</p></body></html>`;

const CONTENT_TYPE: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json",
  ico: "image/x-icon",
};

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = Bun.file(`${DIST_DIR}${rel}`);
  if (await file.exists()) {
    const ext = rel.split(".").pop() ?? "";
    const type = CONTENT_TYPE[ext] ?? "application/octet-stream";
    return new Response(file, {
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  }
  if (pathname === "/") {
    return new Response(DEV_PLACEHOLDER, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response("Not found", { status: 404 });
}

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export interface Studio {
  fetch(req: Request): Promise<Response>;
}

export function createStudio(memory?: MemoryStore): Studio {
  const agentById = new Map(agents.map((a) => [a.id, a]));

  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/api/agents") {
        return Response.json(agents.map((a) => agentInfo(a)));
      }

      if (req.method === "GET" && url.pathname === "/api/agents/graph") {
        const def = agentById.get(url.searchParams.get("id") ?? "");
        if (def === undefined) {
          return Response.json({ error: "에이전트가 없다" }, { status: 404 });
        }
        return Response.json(buildAgentGraph(def, true).getGraph());
      }

      if (req.method === "POST" && url.pathname === "/api/agents/chat") {
        let body: { id?: string; messages?: BaseMessage[]; decision?: string };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return Response.json({ error: "입력 JSON 파싱 실패" }, { status: 400 });
        }
        const def = agentById.get(body.id ?? "");
        if (def === undefined) {
          return Response.json({ error: "에이전트가 없다" }, { status: 404 });
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return Response.json({ error: "messages가 필요하다" }, { status: 400 });
        }
        if (body.decision !== undefined && body.decision !== "allow" && body.decision !== "deny") {
          return Response.json({ error: "decision은 allow 또는 deny다" }, { status: 400 });
        }
        try {
          return Response.json(await agentTurn(def, body.messages, body.decision, memory));
        } catch (e) {
          return Response.json({ error: describe(e) }, { status: 500 });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/memory") {
        if (memory === undefined) return Response.json({ episodes: [], events: [], facts: [] });
        const agent = url.searchParams.get("agent") ?? undefined;
        return Response.json({
          episodes: memory.episodes(agent),
          events: memory.valueEvents(agent),
          facts: agent === undefined ? [] : memory.scoredFacts(agent),
        });
      }

      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        return serveStatic(url.pathname);
      }

      return new Response("Not found", { status: 404 });
    },
  };
}
