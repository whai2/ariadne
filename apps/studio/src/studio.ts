import { MemoryStore } from "@ariadne/memory";
import { agentsController } from "./controllers/agents";
import { memoryController } from "./controllers/memory";
import { threadsController } from "./controllers/threads";
import { createRouter } from "./http/router";
import { serveStatic } from "./http/static";
import { type AgentServiceOptions, createAgentService } from "./services/agents";
import { createMemoryService } from "./services/memory";
import { createSessions } from "./sessions";

/**
 * 조립 자리. 의존은 한 방향으로만 흐른다:
 *
 *   http/router  →  controllers/  →  services/  →  domain/  →  @ariadne/* 링
 *
 * 저장소(`MemoryStore`)는 여기서 서비스에 주입될 뿐, 라우터·컨트롤러는 그 존재를 모른다.
 */

export interface Studio {
  fetch(req: Request): Promise<Response>;
  close(): void;
}

export function createStudio(memory?: MemoryStore, options: AgentServiceOptions = {}): Studio {
  const store = memory ?? MemoryStore.open();
  const service = createAgentService(store, memory, options);
  const agents = agentsController(service);
  const threads = threadsController(createSessions(store, service));
  const mem = memoryController(createMemoryService(memory));

  const fetch = createRouter(
    [
      { method: "GET", path: "/api/agents", handler: agents.list },
      { method: "GET", path: "/api/agents/graph", handler: agents.graph },
      { method: "POST", path: "/api/threads", handler: threads.create },
      { method: "GET", path: "/api/threads/:id", handler: threads.get },
      { method: "POST", path: "/api/threads/:id/messages", handler: threads.send },
      { method: "GET", path: "/api/memory", handler: mem.view },
    ],
    (req, url) =>
      req.method === "GET" && !url.pathname.startsWith("/api/")
        ? serveStatic(url.pathname)
        : new Response("Not found", { status: 404 }),
  );

  return {
    fetch,
    close: () => {
      if (memory === undefined) store.close();
    },
  };
}
