// 모델 라우터 — `"provider/model"` 문자열 하나로 어느 프로바이더든 고른다.
//
// 이 파일이 답하는 질문은 하나다: **"200개 넘는 프로바이더를 어떻게 감당하나?"**
// 답은 "어댑터를 200개 짜지 않는다"이다. 와이어 포맷은 몇 개뿐이고, 나머지 차이는
// **baseURL과 환경변수 이름**이라 표로 들어간다([`registry.generated.ts`]).
//
//   model("anthropic/claude-opus-5")                  → 네이티브 Anthropic
//   model("openrouter/anthropic/claude-sonnet-4.5")   → 게이트웨이 (OpenAI 호환)
//   model("groq/llama-3.3-70b")                       → OpenAI 호환
//
// langchain은 프로바이더마다 패키지를 깔게 하고(`@langchain/openai`…), mastra는 이 표
// 방식을 쓴다. 우리는 후자다 — 어댑터 둘로 대부분이 덮인다.

import { anthropicChat } from "./anthropic";
import { claudeCodeChat } from "./claudeCode";
import {
  MissingApiKeyError,
  MissingProviderConfigError,
  UnknownProviderError,
  UnsupportedProviderError,
} from "./errors";
import { openaiCompatible } from "./openaiCompatible";
import { PROVIDERS } from "./registry.generated";
import type { ChatModel } from "./types";

/** 프로바이더 한 개의 접속 정보. 생성기가 models.dev에서 뽑아 채운다. */
export interface ProviderEntry {
  /**
   * 어느 어댑터가 맡나. 앞의 둘은 **와이어 포맷**이 다르고,
   * `claudeCode`는 아예 **트랜스포트**가 다르다(HTTP가 아니라 로컬 서브프로세스).
   */
  format: "anthropic" | "openai" | "claudeCode" | "unsupported";
  /** 사람이 읽는 이름. */
  name: string;
  /** 베이스 URL. 없으면 어댑터(SDK)의 기본값을 쓴다. `${VAR}`를 포함할 수 있다(→ `apiVars`). */
  api?: string;
  /**
   * `api`를 조립하는 데 필요한 환경변수 이름들. Databricks·Snowflake처럼 **워크스페이스마다
   * URL이 다른** 프로바이더가 여기 해당한다. 이 이름들은 `env`에도 들어있지만
   * **API 키가 아니라 URL 조각**이므로 키 후보에서 빼야 한다.
   */
  apiVars?: string[];
  /** API 키를 찾을 환경변수 후보. 앞에서부터 본다. (`apiVars`에 든 건 제외된다) */
  env: string[];
  /** unsupported일 때만 — 어떤 어댑터가 필요한지 알려주려고 남긴다. */
  npm?: string;
}

export { PROVIDERS };

/** 스펙 문자열을 푼 결과. */
export interface ResolvedSpec {
  provider: string;
  /** 프로바이더에게 넘길 모델 ID. 게이트웨이면 `"anthropic/claude-sonnet-4.5"`처럼 슬래시를 포함한다. */
  modelId: string;
  entry: ProviderEntry;
}

/**
 * `"provider/model"`을 푼다. **순수 함수** — env도 네트워크도 안 본다.
 *
 * 첫 `/`까지가 프로바이더, 나머지 전부가 모델 ID다. 게이트웨이는 모델 ID 안에 또
 * 슬래시가 있어서(`openrouter/anthropic/claude-sonnet-4.5`) 이 규칙이어야 한다.
 */
export function resolveSpec(spec: string): ResolvedSpec {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) {
    throw new UnknownProviderError(spec, `"provider/model" 형태여야 한다 (받은 값: "${spec}")`);
  }
  const provider = spec.slice(0, slash);
  const modelId = spec.slice(slash + 1);

  const entry = PROVIDERS[provider];
  if (entry === undefined) {
    throw new UnknownProviderError(provider);
  }
  if (entry.format === "unsupported") {
    throw new UnsupportedProviderError(provider, entry.name, entry.npm);
  }
  return { provider, modelId, entry };
}

/**
 * baseURL을 만든다. `${VAR}` 자리를 환경변수로 채운다.
 * 워크스페이스마다 URL이 다른 프로바이더(Databricks·Snowflake·Cloudflare…)를 위한 것.
 */
function resolveApi(
  provider: string,
  entry: ProviderEntry,
  apiVars: string[],
  env: Record<string, string | undefined>,
): string | undefined {
  if (entry.api === undefined || apiVars.length === 0) return entry.api;

  const missing = apiVars.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new MissingProviderConfigError(provider, missing, entry.api);
  }
  return entry.api.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => env[name] as string);
}

/**
 * 레지스트리의 baseURL을 **그 어댑터의 SDK 규약에 맞게** 고친다. 순수 함수.
 *
 * 두 SDK가 정반대다:
 * - **Anthropic SDK**는 baseURL 뒤에 `/v1/messages`를 붙인다 → baseURL에 `/v1`이 있으면
 *   `/v1/v1/messages`가 된다. models.dev는 (Vercel AI SDK 규약대로) `/v1`을 포함해 주므로 뗀다.
 * - **OpenAI SDK**는 baseURL에 `/v1`이 **있어야** 한다 → 그대로 둔다.
 *
 * 사용자가 `config.baseURL`로 직접 준 값도 같은 규칙을 탄다 — 어느 쪽 형태로 적든 돌게.
 */
export function adapterBaseURL(
  format: ProviderEntry["format"],
  api: string | undefined,
  config: { baseURL?: string } = {},
): string | undefined {
  const raw = config.baseURL ?? api;
  if (raw === undefined) return undefined;
  return format === "anthropic" ? raw.replace(/\/v1\/?$/, "") : raw;
}

/**
 * **키를 안 줘도 되는 프로바이더.** 우리가 쓰는 SDK가 스스로 자격증명을 찾기 때문이다.
 *
 * Anthropic SDK의 해석 순서: `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` →
 * `ant auth login`이 심어둔 **OAuth 프로필** → Workload Identity Federation.
 * 즉 레지스트리가 아는 `ANTHROPIC_API_KEY`는 그 여러 경로 중 **하나일 뿐**이다.
 * 우리가 "키 없음"으로 단정하고 던지면 나머지 경로를 통째로 막게 된다.
 *
 * **본가일 때만 성립한다.** baseURL을 MiniMax로 돌려놓고 SDK의 자격증명 해석을 기대하면
 * 엉뚱한 키가 실려 나간다 — 그래서 아래에서 `baseURL === undefined`를 같이 본다.
 */
const SDK_RESOLVES_CREDENTIALS = new Set(["anthropic", "openai"]);

export interface ModelConfig {
  /** 직접 주는 API 키. 없으면 레지스트리가 지정한 환경변수에서 찾는다. */
  apiKey?: string;
  /** 베이스 URL 덮어쓰기(사설 프록시 등). 없으면 레지스트리 값 → SDK 기본값. */
  baseURL?: string;
  maxTokens?: number;
  system?: string;
  /** 환경변수 출처. 기본은 `process.env` — 테스트가 여기를 갈아끼운다. */
  env?: Record<string, string | undefined>;
}

/**
 * 스펙 문자열로 `ChatModel`을 만든다.
 *
 * ```ts
 * const m = model("openrouter/anthropic/claude-sonnet-4.5");
 * g.addNode("model", async (s) => ({ messages: [await m.invoke(s.messages)] }));
 * ```
 *
 * 키가 없으면 **어느 환경변수가 필요한지 이름을 말해주며** 즉시 실패한다 —
 * 단 SDK가 스스로 자격증명을 찾을 수 있는 본가 프로바이더는 예외다
 * (→ `SDK_RESOLVES_CREDENTIALS`). 그 경우 판단을 SDK에 넘긴다.
 */
export function model(spec: string, config: ModelConfig = {}): ChatModel {
  const { provider, modelId, entry } = resolveSpec(spec);

  // Claude Code는 HTTP를 안 탄다 — baseURL도 API 키도 우리 소관이 아니다.
  // 자격증명은 `claude` 바이너리가 자기 것을 쓴다(로그인돼 있으면 그대로 돈다).
  if (entry.format === "claudeCode") {
    return claudeCodeChat({
      provider,
      ...(modelId === "default" ? {} : { model: modelId }),
      ...(config.system === undefined ? {} : { system: config.system }),
    });
  }

  const env = config.env ?? process.env;
  const apiVars = entry.apiVars ?? [];

  const baseURL = adapterBaseURL(entry.format, resolveApi(provider, entry, apiVars, env), config);

  // URL 조각으로 쓰이는 환경변수는 **키 후보가 아니다.** 이걸 안 빼면
  // Databricks에서 `DATABRICKS_HOST`(URL)를 API 키로 집는다.
  const keyNames = entry.env.filter((name) => !apiVars.includes(name));
  const apiKey = config.apiKey ?? keyNames.map((name) => env[name]).find((v) => v);

  if (apiKey === undefined || apiKey === "") {
    // 본가 + baseURL 미지정이면 SDK에 맡긴다(OAuth 프로필·AUTH_TOKEN·WIF 등).
    // **대가는 있다**: 정말 아무 자격증명도 없으면 여기가 아니라 첫 호출에서 터진다.
    if (!(SDK_RESOLVES_CREDENTIALS.has(provider) && baseURL === undefined)) {
      throw new MissingApiKeyError(provider, keyNames.length > 0 ? keyNames : entry.env);
    }
  }

  const shared = {
    model: modelId,
    // apiKey를 **넘기지 않는 것**과 빈 값을 넘기는 건 다르다 — 안 넘겨야 SDK가 찾는다.
    ...(apiKey === undefined || apiKey === "" ? {} : { apiKey }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.system === undefined ? {} : { system: config.system }),
  };

  return entry.format === "anthropic"
    ? anthropicChat({ ...shared, provider })
    : openaiCompatible({ ...shared, provider });
}

/** 레지스트리에 있는 프로바이더 목록. `format`으로 걸러 볼 수 있다. */
export function listProviders(format?: ProviderEntry["format"]): string[] {
  return Object.keys(PROVIDERS)
    .filter((id) => format === undefined || PROVIDERS[id]?.format === format)
    .sort();
}
