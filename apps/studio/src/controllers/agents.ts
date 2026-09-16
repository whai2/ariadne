import type { Handler } from "../http/router";
import type { AgentService } from "../services/types";

export function agentsController(service: AgentService): { list: Handler; graph: Handler } {
  return {
    list: () => Response.json(service.list()),
    graph: (_req, url) => Response.json(service.graph(url.searchParams.get("id") ?? "")),
  };
}
