import { describe, expect, it } from "bun:test";
import { END, START, StateGraph, type StateSchema } from "../src";

interface S {
  log: string[];
}

const concatLog: StateSchema<S> = { log: { reducer: (a, b) => [...a, ...b] } };

/**
 * 비대칭 팬인:  START→a→b───────→d→END
 *                     ↘c→e→──────↗
 * b는 a 다음(1칸), e는 c 다음(2칸)이라 d로 가는 두 경로 길이가 다르다.
 *
 * 여기서 **엣지 두 종류의 차이**가 드러난다(V7):
 * - 개별 엣지 `addEdge("b","d")` + `addEdge("e","d")`: 둘 다 같은 트리거 채널
 *   `branch:to:d`(EphemeralValue)에 쓴다. 먼저 온 쪽이 곧바로 d를 깨우므로 d가 두 번 돈다.
 * - 다중소스 엣지 `addEdge(["b","e"], "d")`: `join:b+e:d`(NamedBarrierValue)를 만들고
 *   b·e가 각자 자기 이름을 쓴다. 둘 다 모여야 열리므로 **도착 스텝이 달라도** d는 한 번.
 *
 * 즉 "기다림"은 스케줄러가 아니라 **채널 종류가 정한다**. 스케줄링이 채널 위로 올라온
 * V7이라 가능한 얘기다.
 */
function staggered(join: boolean) {
  const dRuns = { n: 0 };
  const g = new StateGraph<S>(concatLog);
  g.addNode("a", () => ({ log: ["a"] }));
  g.addNode("b", () => ({ log: ["b"] }));
  g.addNode("c", () => ({ log: ["c"] }));
  g.addNode("e", () => ({ log: ["e"] }));
  g.addNode("d", () => {
    dRuns.n++;
    return { log: ["d"] };
  });
  g.addEdge(START, "a");
  g.addEdge("a", "b");
  g.addEdge("a", "c");
  g.addEdge("c", "e");
  if (join) {
    g.addEdge(["b", "e"], "d"); // 배리어: b·e를 둘 다 기다린다
  } else {
    g.addEdge("b", "d"); // 짧은 경로: b가 step1 뒤 d를 깨움
    g.addEdge("e", "d"); // 긴 경로: e는 step2 뒤에야 d를 깨움
  }
  g.addEdge("d", END);
  return { graph: g.compile(), dRuns };
}

describe("V7 · 비대칭 팬인 — 기다림은 채널 종류가 정한다", () => {
  it("개별 엣지는 안 기다린다 → 먼저 온 쪽이 d를 깨워 두 번 실행된다", async () => {
    const { graph, dRuns } = staggered(false);
    const out = await graph.invoke({ log: [] });

    expect(dRuns.n).toBe(2);
    expect(out.log).toEqual(["a", "b", "c", "d", "e", "d"]);
  });

  it("다중소스 엣지(NamedBarrierValue)는 b·e를 다 기다려 d가 한 번만 돈다", async () => {
    const { graph, dRuns } = staggered(true);

    const steps = [];
    for await (const step of graph.stream({ log: [] })) {
      steps.push(step);
    }
    // step0: a / step1: b·c(b는 배리어에 이름만 쓰고 대기) / step2: e / step3: d
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b", "c"], ["e"], ["d"]]);
    expect(dRuns.n).toBe(1);
    expect(steps.at(-1)?.state.log).toEqual(["a", "b", "c", "e", "d"]);
  });
});
