import {
  ai,
  type CompiledGraph,
  END,
  human,
  isToolMessage,
  type MessagesState,
  messagesSchema,
  Send,
  START,
  StateGraph,
  type StateSchema,
} from "@ariadne/core";
import { model } from "@ariadne/model";
import { add, multiply, toolNode, toolsCondition } from "@ariadne/tools";

/** 스튜디오가 고를 수 있는 예제 하나. 타입은 지우고(런타임 데모) 이름/설명/샘플입력을 곁들인다. */
export interface Example {
  id: string;
  name: string;
  description: string;
  sampleInput: Record<string, unknown>;
  /**
   * 그래프를 만든다. **지연 생성이다.**
   *
   * 진짜 모델을 쓰는 예제는 `model()`이 자격증명을 못 찾으면 던지는데, 그게 import 시점에
   * 터지면 **스튜디오 전체가 안 뜬다**. 그래서 고를 때까지 안 만든다.
   * `spec`은 live 예제에서만 의미가 있다(`"claude-code/sonnet"` 같은 모델 지정).
   */
  build: (spec?: string) => CompiledGraph<Record<string, unknown>>;
  /** 진짜 모델을 부르는가. UI가 배지를 띄우고 "몇 초 걸린다"고 알린다. */
  live?: boolean;
}

/** 타입 있는 그래프를 만들어 Example로 담는다(타입은 경계에서 지운다). */
function example<S extends object>(
  meta: { id: string; name: string; description: string; sampleInput: S; live?: boolean },
  build: (g: StateGraph<S>, spec: string) => void,
  schema?: StateSchema<S>,
): Example {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    sampleInput: meta.sampleInput as unknown as Record<string, unknown>,
    ...(meta.live === undefined ? {} : { live: meta.live }),
    build: (spec = DEFAULT_SPEC) => {
      const g = new StateGraph<S>(schema);
      build(g, spec);
      return g.compile() as unknown as CompiledGraph<Record<string, unknown>>;
    },
  };
}

/**
 * live 예제의 기본 모델. **Claude Code를 고른 건 의도적이다** — API 키가 없어도
 * (로그인만 돼 있으면) 돌기 때문에, 스튜디오를 열자마자 진짜 모델을 볼 수 있다.
 * UI에서 `"groq/llama-3.3-70b"` 같은 다른 스펙으로 바꿀 수 있다.
 */
const DEFAULT_SPEC = "claude-code/sonnet";

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

  example<{ log: string[] }>(
    {
      id: "staggered",
      name: "비대칭 팬인(개별 엣지)",
      description:
        "START→a→b→d / a→c→e→d. d로 가는 두 경로 길이가 다르다(b는 1칸, e는 2칸). 개별 엣지는 같은 트리거 채널에 쓰므로 먼저 온 쪽이 곧바로 d를 깨운다 → d가 'Step 2'와 'Step 3'에 **두 번** 실행, log 끝이 …d, e, d. 기다리게 하려면 아래 join 예제처럼 다중소스 엣지를 쓴다.",
      sampleInput: { log: [] },
    },
    (g) => {
      g.addNode("a", () => ({ log: ["a"] }));
      g.addNode("b", () => ({ log: ["b"] }));
      g.addNode("c", () => ({ log: ["c"] }));
      g.addNode("e", () => ({ log: ["e"] }));
      g.addNode("d", () => ({ log: ["d"] }));
      g.addEdge(START, "a");
      g.addEdge("a", "b");
      g.addEdge("a", "c"); // 분기
      g.addEdge("b", "d"); // 짧은 경로: b가 step1 뒤 d를 깨움
      g.addEdge("c", "e");
      g.addEdge("e", "d"); // 긴 경로: e는 step2 뒤에야 d를 깨움 → d가 못 기다림
      g.addEdge("d", END);
    },
    { log: { reducer: (a, b) => [...a, ...b] } },
  ),

  example<{ log: string[] }>(
    {
      id: "join",
      name: "비대칭 팬인(배리어 join)",
      description:
        "같은 그래프인데 d로 들어오는 엣지만 다중소스(addEdge([b,e], d))로 바꿨다. join:b+e:d 배리어(NamedBarrierValue)가 b·e를 **둘 다** 기다리므로 d는 Step 3에 **한 번**만 실행된다 → log가 a,b,c,e,d. 기다림은 스케줄러가 아니라 채널 종류가 정한다(V7).",
      sampleInput: { log: [] },
    },
    (g) => {
      g.addNode("a", () => ({ log: ["a"] }));
      g.addNode("b", () => ({ log: ["b"] }));
      g.addNode("c", () => ({ log: ["c"] }));
      g.addNode("e", () => ({ log: ["e"] }));
      g.addNode("d", () => ({ log: ["d"] }));
      g.addEdge(START, "a");
      g.addEdge("a", "b");
      g.addEdge("a", "c");
      g.addEdge("c", "e");
      g.addEdge(["b", "e"], "d"); // 배리어: b·e가 다 와야 d가 깨어난다
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

  example<MessagesState>(
    {
      id: "react",
      name: "ReAct 에이전트 루프 (진짜 툴)",
      description:
        "model ⇄ tools 반복 후 종료. **문자열 규약이 아니라 진짜 toolCalls/tool 메시지로 돈다**(F2) — 모델이 한 턴에 add·multiply 둘을 부르고, toolNode(@ariadne/tools)가 zod로 인자를 검증해 **병렬 실행**한 뒤 호출 id마다 결과를 하나씩 낸다. 툴은 진짜로 돌고 모델만 가짜다(결정론적이어야 관찰이 된다). messages 채널 값에서 toolCalls의 id와 tool 메시지의 toolCallId가 짝을 이루는 걸 보라. (조건/루프 엣지는 Run 스텝으로 관찰)",
      sampleInput: { messages: [human("3+4랑 5×6 계산해줘")] },
    },
    (g) => {
      // 가짜 모델. **상태를 안 들고 messages만 보고 정한다** — 스튜디오는 컴파일된 그래프를
      // 캐시해 여러 번 돌리므로, 턴 카운터를 클로저에 두면 두 번째 Run이 다르게 굴러버린다.
      g.addNode("model", (s) => {
        const results = s.messages.filter(isToolMessage);
        if (results.length > 0) {
          return { messages: [ai(`계산 결과: ${results.map((m) => m.content).join(" · ")}`)] };
        }
        return {
          messages: [
            ai("", undefined, [
              { id: "call_1", name: "add", args: { a: 3, b: 4 } },
              { id: "call_2", name: "multiply", args: { a: 5, b: 6 } },
            ]),
          ],
        };
      });
      // 노드 이름이 "tools"인 건 toolsCondition이 그 이름을 돌려주기 때문이다(langgraph도 같다).
      g.addNode("tools", toolNode<MessagesState>([add, multiply]));
      g.addEdge(START, "model");
      g.addConditionalEdges("model", toolsCondition, ["tools", END]); // path_map: 루프를 그림에 남긴다
      g.addEdge("tools", "model"); // 툴 결과를 들고 다시 model로 (루프)
    },
    messagesSchema,
  ),

  example<MessagesState>(
    {
      id: "react-repair",
      name: "툴 인자 검증 실패 → 자가 수정",
      description:
        '같은 루프인데 모델이 add(a: "셋")처럼 **스키마를 어긴 인자**를 보낸다. toolNode는 던지지 않고 status:"error" 툴 메시지로 어느 인자가 왜 틀렸는지 돌려주고, 모델은 다음 턴에 스스로 고친다 → 스텝이 5개(model·tools·model·tools·model). 이게 툴 링 에러 정책의 절반이다. 나머지 절반: **툴 본문이 던지면 그대로 전파한다**(모델이 고칠 수 없는 우리 버그라서).',
      sampleInput: { messages: [human("3+4 계산해줘")] },
    },
    (g) => {
      g.addNode("model", (s) => {
        // 마지막 툴 결과 하나만 보면 세 상황이 갈린다 — 이것도 상태 없이 돌기 위한 조건이다.
        const last = s.messages.filter(isToolMessage).at(-1);
        if (last === undefined) {
          return {
            messages: [ai("", undefined, [{ id: "c1", name: "add", args: { a: "셋", b: 4 } }])],
          };
        }
        if (last.status === "error") {
          return {
            messages: [ai("", undefined, [{ id: "c2", name: "add", args: { a: 3, b: 4 } }])],
          };
        }
        return { messages: [ai(`답: ${last.content}`)] };
      });
      g.addNode("tools", toolNode<MessagesState>([add, multiply]));
      g.addEdge(START, "model");
      g.addConditionalEdges("model", toolsCondition, ["tools", END]);
      g.addEdge("tools", "model");
    },
    messagesSchema,
  ),

  example<{ query: string; docs: string[]; summaries: string[]; answer: string }>(
    {
      id: "rag",
      name: "RAG (map-reduce)",
      description:
        "retrieve → 검색 문서 N개를 Send로 병렬 요약(V6) → 리듀서로 취합 → generate. 문서 개수는 런타임에 결정된다. 실제 LLM/검색은 가짜. (Send 팬아웃은 그림엔 안 보이고 Run에서 'summarize ×N'으로 관찰)",
      sampleInput: { query: "AI란?", docs: [], summaries: [], answer: "" },
    },
    (g) => {
      g.addNode("retrieve", (s) => ({
        docs: [`${s.query} 문서1`, `${s.query} 문서2`, `${s.query} 문서3`],
      }));
      g.addNode<string>("summarize", (doc) => ({ summaries: [`요약(${doc})`] }));
      g.addNode("generate", (s) => ({ answer: `답변: ${s.summaries.join(" / ")}` }));
      g.addEdge(START, "retrieve");
      g.addConditionalEdges("retrieve", (s) => s.docs.map((d) => new Send("summarize", d)), [
        "summarize", // Send도 대상을 적어주면 팬아웃이 그림에 나온다
      ]);
      g.addEdge("summarize", "generate"); // N개의 summarize가 generate로 팬인
      g.addEdge("generate", END);
    },
    { summaries: { reducer: (a, b) => [...a, ...b] } },
  ),

  // ─── 여기부터는 **진짜 모델을 부른다** ────────────────────────────────────────
  // 위 예제들과 그래프 구조가 다르지 않다는 게 요점이다. 노드 안에서 가짜 함수 대신
  // model().invoke를 부를 뿐, 엣지·스키마·스텝 관찰은 전부 그대로다.

  example<MessagesState>(
    {
      id: "live-chat",
      name: "🔴 실제 모델 — 한 턴",
      description:
        "START→model→END. **진짜 모델이 답한다.** 기본은 claude-code/sonnet(API 키 불필요, Claude Code 로그인만 있으면 됨). 위 'reduce' 예제와 그래프가 똑같다 — 노드 안이 가짜 함수에서 model().invoke로 바뀐 것뿐이다. 응답까지 몇 초 걸린다.",
      sampleInput: { messages: [human("슈퍼스텝(BSP)이 뭔지 두 문장으로 설명해줘.")] },
      live: true,
    },
    (g, spec) => {
      const m = model(spec, { system: "간결하게 한국어로 답한다.", maxTokens: 1024 });
      g.addNode("model", async (s) => ({ messages: [await m.invoke(s.messages)] }));
      g.addEdge(START, "model");
      g.addEdge("model", END);
    },
    messagesSchema,
  ),

  example<MessagesState & { turns: number }>(
    {
      id: "live-loop",
      name: "🔴 실제 모델 — 멀티턴 루프",
      description:
        "model이 자기 자신을 가리키는 조건부 엣지(V5)로 2턴 돈다. 매 턴 이전 대화 전체가 모델에 실려 가고, messages가 addMessages로 누적된다(V8). **V5+V8+F1이 한 그래프에서 만나는 지점.** 모델을 두 번 부르므로 그만큼 더 걸린다.",
      sampleInput: { messages: [human("1부터 세어봐. 한 번에 숫자 하나씩만.")], turns: 0 },
      live: true,
    },
    (g, spec) => {
      const m = model(spec, { system: "아주 짧게 답한다.", maxTokens: 256 });
      g.addNode("model", async (s) => ({
        messages: [await m.invoke(s.messages)],
        turns: 1,
      }));
      g.addEdge(START, "model");
      g.addConditionalEdges("model", (s) => (s.turns < 2 ? "model" : END), ["model", END]);
    },
    { ...messagesSchema, turns: { reducer: (a, b) => a + b } },
  ),
];
