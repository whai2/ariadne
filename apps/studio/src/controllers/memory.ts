import type { Handler } from "../http/router";
import type { MemoryService } from "../services/types";

export function memoryController(service: MemoryService): { view: Handler } {
  return {
    view: (_req, url) => Response.json(service.view(url.searchParams.get("agent") ?? undefined)),
  };
}
