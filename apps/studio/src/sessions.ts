import { pendingToolCalls } from "@ariadne/agent";
import type { BaseMessage } from "@ariadne/core";
import type { MemoryStore } from "@ariadne/memory";
import { BadRequestError, NotFoundError } from "./errors";
import type { AgentService, ThreadService, ThreadView } from "./services/types";

/** thread의 소유 에이전트와 상태는 DB에 둔다. 프로세스 메모리에 대화 이력을 보관하지 않는다. */
export function createSessions(store: MemoryStore, agents: AgentService): ThreadService {
  function get(id: string): ThreadView {
    const row = store.getThread(id);
    if (!row) throw new NotFoundError("대화가 없다");
    const state = store.getLatest(id)?.channels ?? {};
    const messages = (state.messages ?? []) as BaseMessage[];
    return {
      id,
      agentId: row.agent,
      createdAt: row.created_at,
      messages,
      pending: pendingToolCalls(messages),
      state,
    };
  }
  return {
    create(agentId) {
      if (!agents.list().some((a) => a.id === agentId)) throw new NotFoundError("에이전트가 없다");
      const id = crypto.randomUUID();
      store.createThread(id, agentId);
      return get(id);
    },
    get,
    async send(id, input) {
      const thread = get(id);
      const waiting = thread.pending.length > 0;
      if (waiting && input.decision === undefined)
        throw new BadRequestError("대기 중인 툴 호출을 먼저 승인하거나 거부하세요");
      if (!waiting && input.decision !== undefined)
        throw new BadRequestError("승인 대기 중인 툴 호출이 없다");
      if (waiting) {
        const agent = agents.list().find((a) => a.id === thread.agentId);
        if (!thread.pending.some((call) => agent?.approval?.includes(call.name))) {
          throw new BadRequestError(
            "대기 중인 호출의 승인 정책이 변경되었습니다. 에이전트 설정을 확인하세요",
          );
        }
        if (thread.pending.some((call) => !agent?.tools.includes(call.name))) {
          throw new BadRequestError("대기 중인 툴을 사용할 수 없다. 연결 상태를 확인하세요");
        }
      }
      const reply = await agents.turn(thread.agentId, id, input);
      return { ...reply, thread: get(id) };
    },
  };
}
