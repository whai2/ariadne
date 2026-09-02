import { describe, expect, it } from "bun:test";
import { type DemoState, sampleGraph } from "../src/sampleGraph";
import { createStudio } from "../src/studio";

const studio = createStudio(sampleGraph());

describe("Studio fetch 핸들러", () => {
  it("GET / 는 HTML 페이지를 준다", async () => {
    const res = await studio.fetch(new Request("http://x/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Ariadne Studio");
  });

  it("GET /api/graph 는 그래프 구조를 준다", async () => {
    const res = await studio.fetch(new Request("http://x/api/graph"));
    const g = (await res.json()) as { nodes: string[]; edges: unknown[] };
    expect(g.nodes).toEqual(["greet", "shout"]);
    expect(g.edges.length).toBe(3);
  });

  it("POST /api/run 은 스텝별 상태를 준다", async () => {
    const input: DemoState = { text: "hi", steps: 0 };
    const res = await studio.fetch(
      new Request("http://x/api/run", { method: "POST", body: JSON.stringify(input) }),
    );
    const { steps } = (await res.json()) as {
      steps: Array<{ node: string; state: DemoState }>;
    };
    expect(steps.map((s) => s.node)).toEqual(["greet", "shout"]);
    expect(steps.at(-1)?.state.steps).toBe(2);
  });

  it("잘못된 JSON은 400", async () => {
    const res = await studio.fetch(
      new Request("http://x/api/run", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("모르는 경로는 404", async () => {
    const res = await studio.fetch(new Request("http://x/nope"));
    expect(res.status).toBe(404);
  });
});
