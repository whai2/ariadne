import type { MemoryStore } from "@ariadne/memory";
import type { MemoryService } from "./types";

/** 메모리 서비스 — 쌓인 것을 읽기만 한다. 스토어가 없으면 **빈 뷰**다(메모리 없이도 도는 계약). */
export function createMemoryService(memory?: MemoryStore): MemoryService {
  return {
    view(agent) {
      if (memory === undefined) return { episodes: [], events: [], facts: [] };
      return {
        episodes: memory.episodes(agent),
        events: memory.valueEvents(agent),
        facts: agent === undefined ? [] : memory.scoredFacts(agent),
      };
    },
  };
}
