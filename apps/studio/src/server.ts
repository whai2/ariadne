import { examples } from "./examples";
import { createStudio } from "./studio";

const studio = createStudio(examples);
const server = Bun.serve({ port: 4111, fetch: studio.fetch });

console.log(`Ariadne Studio ▶ ${server.url}`);
