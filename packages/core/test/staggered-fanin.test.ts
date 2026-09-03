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
 * 우리 엔진의 한계: 활성 집합을 "직전 스텝 아웃엣지 대상"으로 계산하므로(pregel.ts),
 * 들어오는 엣지 하나만 발화해도 d를 깨운다 → d가 b쪽(step2)과 e쪽(step3) 두 번 실행된다.
 * "진짜 join"이면 b·e가 **둘 다** 도착할 때까지 기다려 d를 **한 번만** 실행해야 한다.
 *
 * → V7에서 다중소스 엣지를 NamedBarrierValue("join:b+e:d") 채널로 낮추면 해결된다.
 *   이 테스트는 그때까지의 현재(한계) 동작을 고정하는 회귀 가드다.
 */
function staggered() {
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
  g.addEdge("b", "d"); // 짧은 경로: b가 step1 뒤 d를 깨움
  g.addEdge("c", "e");
  g.addEdge("e", "d"); // 긴 경로: e는 step2 뒤에야 d를 깨움
  g.addEdge("d", END);
  return { graph: g.compile(), dRuns };
}

describe("비대칭 팬인 — 우리 엔진의 한계(→ V7 NamedBarrierValue)", () => {
  it("[현재/한계] d가 b·e를 못 기다려 두 번 실행된다", async () => {
    const { graph, dRuns } = staggered();
    const out = await graph.invoke({ log: [] });

    // FIXME(V7): NamedBarrierValue join으로 고치면 아래 기대값이 바뀐다.
    //   진짜 join → dRuns.n === 1, log의 "d"는 1개, 최종 log 길이 5.
    expect(dRuns.n).toBe(2); // ← 지금은 2 (한계)
    expect(out.log.filter((x) => x === "d")).toHaveLength(2); // ← "d"가 중복
    expect(out.log).toEqual(["a", "b", "c", "d", "e", "d"]);
  });
});
