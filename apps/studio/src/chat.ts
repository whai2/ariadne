// 챗 플레이그라운드의 서버 쪽. 프로바이더 목록과 한 턴 대화를 담당한다.
//
// **대화도 그래프로 돈다.** 모델을 직접 부르지 않고 `messagesSchema` 그래프를 세워
// `stream()`으로 돌린다 — 그래야 스텝·채널 관찰이 챗에서도 그대로 붙는다.
// (그게 이 스튜디오가 일반 챗 UI와 다른 점이다.)

import {
  type BaseMessage,
  END,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  type StepUpdate,
} from "@ariadne/core";
import { listProviders, model, PROVIDERS } from "@ariadne/model";

/** 드롭다운 한 줄. 키가 있는지까지 알려줘서 고르기 전에 알 수 있게 한다. */
export interface ProviderInfo {
  id: string;
  name: string;
  /** 어느 어댑터가 맡나 — UI가 그룹을 나눈다. */
  format: string;
  /** 지금 이 환경에서 바로 쓸 수 있나. */
  ready: boolean;
  /** 준비가 안 됐다면 무엇이 필요한지. */
  need: string;
  /** 모델 입력칸의 placeholder. 없으면 사용자가 직접 적어야 한다. */
  suggested?: string;
}

/**
 * 자주 쓰는 프로바이더의 **기본 모델 제안**. 순전히 UI 편의다 —
 * 레지스트리에는 모델 목록을 넣지 않기로 했으므로(7,560개), 여기 몇 개만 손으로 둔다.
 * 틀리거나 낡아도 사용자가 입력칸에서 고치면 그만이다.
 */
const SUGGESTED: Record<string, string> = {
  "claude-code": "sonnet",
  anthropic: "claude-opus-5",
  openai: "gpt-5.5",
  google: "gemini-3-pro",
  openrouter: "anthropic/claude-sonnet-4.5",
  groq: "llama-3.3-70b-versatile",
  deepseek: "deepseek-chat",
  xai: "grok-4",
  mistral: "mistral-large-latest",
  togetherai: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  cerebras: "llama-3.3-70b",
  minimax: "MiniMax-M2",
  ollama: "qwen3",
};

/** 눈에 먼저 띄어야 하는 것들. 나머지는 알파벳 순으로 뒤에 붙는다. */
const POPULAR = Object.keys(SUGGESTED);

/** `claude` CLI가 있나 — claudeCode 프로바이더의 준비 조건이다. */
function hasClaudeCli(): boolean {
  try {
    return Bun.spawnSync(["which", "claude"]).exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * 프로바이더 하나가 **지금 쓸 수 있는지** 본다.
 * 레지스트리가 env 이름을 아니까 "무엇이 필요한지"까지 말해줄 수 있다.
 */
export function statusOf(id: string, env: Record<string, string | undefined>): ProviderInfo | null {
  const entry = PROVIDERS[id];
  if (entry === undefined || entry.format === "unsupported") return null;

  const base = {
    id,
    name: entry.name,
    format: entry.format,
    ...(SUGGESTED[id] === undefined ? {} : { suggested: SUGGESTED[id] }),
  };

  if (entry.format === "claudeCode") {
    const ready = hasClaudeCli();
    return { ...base, ready, need: ready ? "" : "`claude` CLI 설치 + 로그인" };
  }

  const apiVars = entry.apiVars ?? [];
  const keyNames = entry.env.filter((n) => !apiVars.includes(n));
  const missingKey = !keyNames.some((n) => env[n]);
  const missingCfg = apiVars.filter((n) => !env[n]);

  // 본가는 키가 없어도 SDK가 OAuth 프로필 등을 찾을 수 있다(F1.6) — 단정하지 않는다.
  const sdkMayResolve = (id === "anthropic" || id === "openai") && entry.api === undefined;

  const need = [
    ...(missingKey && !sdkMayResolve ? [keyNames.join(" 또는 ")] : []),
    ...missingCfg,
  ].join(" · ");
  return { ...base, ready: need === "", need };
}

/** 드롭다운에 넣을 전체 목록. 준비된 것 → 자주 쓰는 것 → 나머지 순. */
export function providerList(
  env: Record<string, string | undefined> = process.env,
): ProviderInfo[] {
  const all = [
    ...listProviders("claudeCode"),
    ...listProviders("anthropic"),
    ...listProviders("openai"),
  ]
    .map((id) => statusOf(id, env))
    .filter((p): p is ProviderInfo => p !== null);

  const rank = (p: ProviderInfo) => {
    const pop = POPULAR.indexOf(p.id);
    return (p.ready ? 0 : 1000) + (pop === -1 ? 500 : pop);
  };
  return all.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export interface ChatReply {
  /** 새로 붙은 AI 메시지들(보통 하나). */
  messages: BaseMessage[];
  /** 그래프가 실제로 뭘 했는지 — 챗에서도 스텝·채널을 볼 수 있게. */
  steps: StepUpdate<MessagesState>[];
}

/**
 * 한 턴 대화. **그래프로 돈다** — `START→model→END`에 messages 리듀서.
 *
 * 이력 전체를 매번 받는다(API가 stateless인 것과 같은 이유). 새로 생긴 메시지만
 * 골라 돌려주므로 클라이언트는 그걸 이어붙이면 된다.
 */
export async function chatTurn(
  spec: string,
  history: BaseMessage[],
  options: { system?: string } = {},
): Promise<ChatReply> {
  const m = model(spec, options.system === undefined ? {} : { system: options.system });

  const g = new StateGraph<MessagesState>(messagesSchema);
  g.addNode("model", async (s) => ({ messages: [await m.invoke(s.messages)] }));
  g.addEdge(START, "model");
  g.addEdge("model", END);

  const steps: StepUpdate<MessagesState>[] = [];
  for await (const step of g.compile().stream({ messages: history })) {
    steps.push(step);
  }

  const final = steps.at(-1)?.state.messages ?? history;
  return { messages: final.slice(history.length), steps };
}
