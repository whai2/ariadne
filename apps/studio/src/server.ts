import { MemoryStore } from "@ariadne/memory";
import { connectMcpAgents } from "./agents";
import { examples } from "./examples";
import { createStudio } from "./studio";

// 포트를 환경변수로 열어둔다 — 이미 떠 있는 스튜디오를 죽이지 않고 새 코드를 띄울 수 있다.
const port = Number(process.env.PORT ?? 4111);

// **서빙 전에** MCP 서버에 붙어 에이전트의 툴을 채운다. 여기가 실패하면(서버가 안 뜨면)
// 그대로 던져 스튜디오가 안 뜬다 — 절반만 붙은 채로 조용히 도는 것보다 낫다.
const closeMcp = await connectMcpAgents();

// 겪은 일과 가치 신호가 쌓일 곳 (F4.1). 아직 아무도 안 읽는다 — 동작은 하나도 안 바뀐다.
const memory = MemoryStore.open(`${import.meta.dir}/../.ariadne/memory.db`);

const studio = createStudio(examples, memory);
const server = Bun.serve({ port, fetch: studio.fetch });

// 연결 수명은 스튜디오가 쥔다. 끄면 자식 프로세스도 정리한다(연결 = 상태의 주인).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void closeMcp().finally(() => {
      memory.close();
      process.exit(0);
    });
  });
}

console.log(`Ariadne Studio ▶ ${server.url}`);
