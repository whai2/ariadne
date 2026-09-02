import { END, START, StateGraph } from "@ariadne/core";

export interface DemoState {
  text: string;
  steps: number;
}

/**
 * Studio가 시각화/실행할 샘플 그래프.
 * (지금은 하드코딩. 나중엔 사용자 그래프를 로드하도록 확장한다.)
 */
export function sampleGraph() {
  const g = new StateGraph<DemoState>();
  g.addNode("greet", (s) => ({ text: `${s.text} → 안녕`, steps: s.steps + 1 }));
  g.addNode("shout", (s) => ({ text: `${s.text}!`, steps: s.steps + 1 }));
  g.addEdge(START, "greet");
  g.addEdge("greet", "shout");
  g.addEdge("shout", END);
  return g.compile();
}
