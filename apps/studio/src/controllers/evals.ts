import type { Handler } from "../http/router";
import type { EvalService } from "../services/types";

export function evalsController(service: EvalService): { suite: Handler; run: Handler } {
  return {
    suite: () => Response.json(service.suite()),
    run: async () => Response.json(await service.run()),
  };
}
