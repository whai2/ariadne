import type { Handler } from "../http/router";
import type { TraceService } from "../services/types";

export function tracesController(service: TraceService): { list: Handler } {
  return {
    list: (_req, _url, params) => Response.json(service.list(params.id ?? "")),
  };
}
