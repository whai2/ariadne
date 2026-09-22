// 재시작/브라우저 검증용 로컬 서버. 외부 모델이나 실제 파일 쓰기를 사용하지 않는다.
import { MemoryStore } from "@ariadne/memory";
import { TraceStore } from "@ariadne/observability";
import { createStudio } from "../../src/studio";
import { setup } from "./thread-agent";

const memory = MemoryStore.open(process.argv[2] ?? ":memory:");
const traces = TraceStore.open(process.argv[3] ?? ":memory:");
const studio = createStudio(memory, setup().options, traces);
const server = Bun.serve({
  port: Number(process.argv[4] ?? 0),
  hostname: "127.0.0.1",
  fetch: studio.fetch,
});
console.log(server.url.toString());
