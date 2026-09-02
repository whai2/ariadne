import { sampleGraph } from "./sampleGraph";
import { createStudio } from "./studio";

const studio = createStudio(sampleGraph());
const server = Bun.serve({ port: 4111, fetch: studio.fetch });

console.log(`Ariadne Studio ▶ ${server.url}`);
