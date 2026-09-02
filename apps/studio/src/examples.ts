import { type CompiledGraph, END, START, StateGraph, type StateSchema } from "@ariadne/core";

/** 스튜디오가 고를 수 있는 예제 하나. 타입은 지우고(런타임 데모) 이름/설명/샘플입력을 곁들인다. */
export interface Example {
  id: string;
  name: string;
  description: string;
  sampleInput: Record<string, unknown>;
  graph: CompiledGraph<Record<string, unknown>>;
}

/** 타입 있는 그래프를 만들어 Example로 담는다(타입은 경계에서 지운다). */
function example<S extends object>(
  meta: { id: string; name: string; description: string; sampleInput: S },
  build: (g: StateGraph<S>) => void,
  schema?: StateSchema<S>,
): Example {
  const g = new StateGraph<S>(schema);
  build(g);
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    sampleInput: meta.sampleInput as unknown as Record<string, unknown>,
    graph: g.compile() as unknown as CompiledGraph<Record<string, unknown>>,
  };
}

type Msg = { role: string; content: string };

export const examples: Example[] = [
  example<{ text: string; steps: number }>(
    {
      id: "linear",
      name: "선형",
      description: "START→greet→shout→END. 기본 순차 실행. 채널 2개(text, steps).",
      sampleInput: { text: "hi", steps: 0 },
    },
    (g) => {
      g.addNode("greet", (s) => ({ text: `${s.text} → 안녕`, steps: s.steps + 1 }));
      g.addNode("shout", (s) => ({ text: `${s.text}!`, steps: s.steps + 1 }));
      g.addEdge(START, "greet");
      g.addEdge("greet", "shout");
      g.addEdge("shout", END);
    },
  ),

  example<{ log: string[] }>(
    {
      id: "diamond",
      name: "다이아몬드(분기·병렬·팬인)",
      description:
        "START→a→{b,c}→d→END. b,c가 한 superstep에 병렬 실행 → 'Step 1: b · c'. log가 concat 리듀서라 두 병렬 쓰기가 합쳐진다. 처음 보는 비선형 그래프!",
      sampleInput: { log: [] },
    },
    (g) => {
      g.addNode("a", () => ({ log: ["a"] }));
      g.addNode("b", () => ({ log: ["b"] }));
      g.addNode("c", () => ({ log: ["c"] }));
      g.addNode("d", () => ({ log: ["d"] }));
      g.addEdge(START, "a");
      g.addEdge("a", "b");
      g.addEdge("a", "c"); // 분기
      g.addEdge("b", "d");
      g.addEdge("c", "d"); // 팬인
      g.addEdge("d", END);
    },
    { log: { reducer: (a, b) => [...a, ...b] } },
  ),

  example<{ topic: string; notes?: string; article?: string }>(
    {
      id: "grow",
      name: "채널이 늘어남",
      description: "노드가 새 키를 쓸 때마다 채널이 생긴다 → 스텝마다 채널 수가 1→2→3으로 증가.",
      sampleInput: { topic: "AI" },
    },
    (g) => {
      g.addNode("research", (s) => ({ notes: `${s.topic} 조사 노트` }));
      g.addNode("write", (s) => ({ article: `# ${s.topic}\n${s.notes ?? ""}` }));
      g.addEdge(START, "research");
      g.addEdge("research", "write");
      g.addEdge("write", END);
    },
  ),

  example<{ messages: Msg[] }>(
    {
      id: "accumulate",
      name: "수동 누적(메시지)",
      description:
        "각 노드가 [...s.messages, x]로 직접 append. LastValue라 손으로 합쳐야 함 → V3 리듀서의 동기.",
      sampleInput: { messages: [{ role: "user", content: "안녕?" }] },
    },
    (g) => {
      g.addNode("assistant", (s) => ({
        messages: [...s.messages, { role: "assistant", content: "반가워요!" }],
      }));
      g.addNode("user", (s) => ({
        messages: [...s.messages, { role: "user", content: "고마워요" }],
      }));
      g.addEdge(START, "assistant");
      g.addEdge("assistant", "user");
      g.addEdge("user", END);
    },
  ),

  example<{ messages: Msg[] }>(
    {
      id: "reduce",
      name: "리듀서 누적(메시지)",
      description:
        "messages에 concat 리듀서. 노드는 [새 메시지]만 반환 → 채널이 자동 append. 타입이 [BinaryOperatorAggregate]. (accumulate와 비교!)",
      sampleInput: { messages: [{ role: "user", content: "안녕?" }] },
    },
    (g) => {
      g.addNode("assistant", () => ({ messages: [{ role: "assistant", content: "반가워요!" }] }));
      g.addNode("user", () => ({ messages: [{ role: "user", content: "고마워요" }] }));
      g.addEdge(START, "assistant");
      g.addEdge("assistant", "user");
      g.addEdge("user", END);
    },
    { messages: { reducer: (a, b) => [...a, ...b] } },
  ),

  example<{ n: number }>(
    {
      id: "counter",
      name: "리듀서 합계",
      description:
        "n에 add 리듀서. 각 노드가 +1(delta)만 반환 → 자동 누적(0→1→2→3). LastValue였다면 1로 덮였을 것.",
      sampleInput: { n: 0 },
    },
    (g) => {
      for (const name of ["a", "b", "c"]) {
        g.addNode(name, () => ({ n: 1 }));
      }
      g.addEdge(START, "a");
      g.addEdge("a", "b");
      g.addEdge("b", "c");
      g.addEdge("c", END);
    },
    { n: { reducer: (a, b) => a + b } },
  ),

  example<{ a: number; b: number; c: number }>(
    {
      id: "preserve",
      name: "부분 업데이트 보존",
      description: "노드가 일부 키만 반환해도 나머지 채널은 값을 유지(LastValue의 덮어쓰기+보존).",
      sampleInput: { a: 1, b: 2, c: 3 },
    },
    (g) => {
      g.addNode("bumpB", (s) => ({ b: s.b + 100 }));
      g.addNode("bumpC", (s) => ({ c: s.c + 100 }));
      g.addEdge(START, "bumpB");
      g.addEdge("bumpB", "bumpC");
      g.addEdge("bumpC", END);
    },
  ),

  example<{ n: number }>(
    {
      id: "long",
      name: "긴 체인",
      description: "5개 노드가 순차로 n+1. 스텝이 5번 — 스텝 개념을 길게 관찰.",
      sampleInput: { n: 0 },
    },
    (g) => {
      for (const name of ["s1", "s2", "s3", "s4", "s5"]) {
        g.addNode(name, (s) => ({ n: s.n + 1 }));
      }
      g.addEdge(START, "s1");
      g.addEdge("s1", "s2");
      g.addEdge("s2", "s3");
      g.addEdge("s3", "s4");
      g.addEdge("s4", "s5");
      g.addEdge("s5", END);
    },
  ),
];
