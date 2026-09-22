import { MemoryStore } from "@ariadne/memory";
import { TraceStore } from "@ariadne/observability";
import { connectMcpAgents } from "./domain/registry";
import { createStudio } from "./studio";

const port = Number(process.env.PORT ?? 4111);

const closeMcp = await connectMcpAgents();
const memory = MemoryStore.open(`${import.meta.dir}/../.ariadne/memory.db`);
const traces = TraceStore.open(`${import.meta.dir}/../.ariadne/traces.db`);

const studio = createStudio(memory, {}, traces);
const server = Bun.serve({ port, fetch: studio.fetch });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void closeMcp().finally(() => {
      memory.close();
      traces.close();
      process.exit(0);
    });
  });
}

console.log(`Ariadne Studio ▶ ${server.url}`);
