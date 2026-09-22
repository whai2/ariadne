import type { MemoryStore } from "@ariadne/memory";
import type { TraceStore } from "@ariadne/observability";
import { NotFoundError } from "../errors";
import type { TraceService } from "./types";

export function createTraceService(threads: MemoryStore, traces: TraceStore): TraceService {
  return {
    list(threadId) {
      if (threads.getThread(threadId) === undefined) throw new NotFoundError("대화가 없다");
      return traces.list(threadId);
    },
  };
}
