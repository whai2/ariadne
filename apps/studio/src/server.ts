import { examples } from "./examples";
import { createStudio } from "./studio";

// 포트를 환경변수로 열어둔다 — 이미 떠 있는 스튜디오를 죽이지 않고 새 코드를 띄울 수 있다.
const port = Number(process.env.PORT ?? 4111);

const studio = createStudio(examples);
const server = Bun.serve({ port, fetch: studio.fetch });

console.log(`Ariadne Studio ▶ ${server.url}`);
