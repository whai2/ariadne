import { describe, expect, test } from "bun:test";
import { human } from "@ariadne/core";
import {
  adapterBaseURL,
  listProviders,
  MissingApiKeyError,
  MissingProviderConfigError,
  model,
  PROVIDERS,
  resolveSpec,
  UnknownProviderError,
  UnsupportedProviderError,
} from "../src/index";

describe("resolveSpec — 순수 파싱", () => {
  test("첫 슬래시까지가 프로바이더, 나머지 전부가 모델 ID", () => {
    const r = resolveSpec("anthropic/claude-opus-5");
    expect(r.provider).toBe("anthropic");
    expect(r.modelId).toBe("claude-opus-5");
    expect(r.entry.format).toBe("anthropic");
  });

  test("게이트웨이는 모델 ID 안에 슬래시가 또 있다 — 안 쪼갠다", () => {
    const r = resolveSpec("openrouter/anthropic/claude-sonnet-4.5");
    expect(r.provider).toBe("openrouter");
    expect(r.modelId).toBe("anthropic/claude-sonnet-4.5"); // 통째로 넘긴다
    expect(r.entry.api).toBe("https://openrouter.ai/api/v1");
  });

  test("모양이 틀렸거나 모르는 프로바이더면 즉시 에러", () => {
    expect(() => resolveSpec("claude-opus-5")).toThrow(UnknownProviderError); // 슬래시 없음
    expect(() => resolveSpec("/model")).toThrow(UnknownProviderError);
    expect(() => resolveSpec("anthropic/")).toThrow(UnknownProviderError);
    expect(() => resolveSpec("그런프로바이더없음/m")).toThrow(UnknownProviderError);
  });

  test("어댑터 없는 와이어 포맷은 뭐가 필요한지 말해준다", () => {
    // Bedrock은 서명 기반 AWS 인증이라 baseURL만 바꿔선 못 부른다.
    expect(() => resolveSpec("amazon-bedrock/claude")).toThrow(UnsupportedProviderError);
    // Vertex도 GCP ADC가 필요하다 — 조용히 OpenAI로 던지면 런타임에 이상하게 실패한다.
    expect(() => resolveSpec("google-vertex/gemini-3-pro")).toThrow(UnsupportedProviderError);
  });
});

describe("model() — 문자열 하나로 어느 프로바이더든", () => {
  const env = {
    ANTHROPIC_API_KEY: "sk-ant",
    OPENROUTER_API_KEY: "sk-or",
    GROQ_API_KEY: "sk-groq",
    MINIMAX_API_KEY: "sk-mm",
  };

  test("네이티브 Anthropic", () => {
    const m = model("anthropic/claude-opus-5", { env });
    expect(m.provider).toBe("anthropic");
    expect(m.modelId).toBe("claude-opus-5");
  });

  test("게이트웨이(OpenRouter) — provider 라벨이 openrouter로 남는다", () => {
    const m = model("openrouter/anthropic/claude-sonnet-4.5", { env });
    expect(m.provider).toBe("openrouter");
    expect(m.modelId).toBe("anthropic/claude-sonnet-4.5");
  });

  test("OpenAI 호환(Groq)", () => {
    expect(model("groq/llama-3.3-70b", { env }).provider).toBe("groq");
  });

  test("**Anthropic 와이어 포맷을 쓰는 다른 프로바이더**도 같은 어댑터로 돈다", () => {
    // MiniMax는 anthropic 포맷 엔드포인트를 낸다 → baseURL만 다르다.
    const m = model("minimax/MiniMax-M2", { env });
    expect(m.provider).toBe("minimax");
    expect(PROVIDERS.minimax?.format).toBe("anthropic");
    expect(PROVIDERS.minimax?.api).toContain("/anthropic/");
  });

  test("Gemini — 네이티브 포맷은 다르지만 구글의 OpenAI 호환 셰임으로 돈다", () => {
    const m = model("google/gemini-3-pro", { env: { GEMINI_API_KEY: "sk-g" } });
    expect(m.provider).toBe("google");
    // 끝 슬래시는 구글 문서 그대로다. "정리"하고 싶어지지만 건드리지 말 것.
    expect(PROVIDERS.google?.api).toBe("https://generativelanguage.googleapis.com/v1beta/openai/");
    // 키 후보가 셋 — 아무거나 있으면 된다.
    expect(PROVIDERS.google?.env).toContain("GEMINI_API_KEY");
    expect(model("google/gemini-3-pro", { env: { GOOGLE_API_KEY: "sk-g" } }).provider).toBe(
      "google",
    );
  });

  test("워크스페이스마다 URL이 다른 프로바이더 — env로 baseURL을 조립한다", () => {
    // Databricks의 env는 [DATABRICKS_HOST, DATABRICKS_TOKEN]인데
    // **첫 번째는 API 키가 아니라 URL 조각**이다. 이걸 안 가리면 URL을 키로 집는다(과거 버그).
    expect(PROVIDERS.databricks?.apiVars).toEqual(["DATABRICKS_HOST"]);

    const m = model("databricks/dbrx", {
      env: { DATABRICKS_HOST: "ws.cloud.databricks.com", DATABRICKS_TOKEN: "dapi-secret" },
    });
    expect(m.provider).toBe("databricks");

    // URL 조각만 있고 진짜 키가 없으면 키 에러 — 그리고 후보에서 HOST가 빠져 있어야 한다.
    try {
      model("databricks/dbrx", { env: { DATABRICKS_HOST: "ws.cloud.databricks.com" } });
      throw new Error("던졌어야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingApiKeyError);
      expect((e as MissingApiKeyError).envVars).toEqual(["DATABRICKS_TOKEN"]);
    }
  });

  test("URL 조각이 없으면 키가 있어도 못 부른다 — 어디로 보낼지 모르니까", () => {
    try {
      model("databricks/dbrx", { env: { DATABRICKS_TOKEN: "dapi-secret" } });
      throw new Error("던졌어야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingProviderConfigError);
      expect((e as MissingProviderConfigError).missing).toEqual(["DATABRICKS_HOST"]);
      expect((e as Error).message).toContain("DATABRICKS_HOST");
    }
  });

  test("템플릿이 있는 엔트리는 반드시 apiVars를 갖는다", () => {
    // 조립을 안 하면 리터럴 플레이스홀더가 baseURL에 그대로 실려 나간다.
    for (const [id, entry] of Object.entries(PROVIDERS)) {
      if (entry.api?.includes("${")) {
        expect(entry.apiVars?.length, `${id}에 apiVars가 없다`).toBeGreaterThan(0);
      }
    }
  });

  test("키가 없으면 **어느 환경변수가 필요한지 이름을 말하며** 실패", () => {
    expect(() => model("groq/llama-3.3-70b", { env: {} })).toThrow(MissingApiKeyError);
    try {
      model("groq/llama-3.3-70b", { env: {} });
    } catch (e) {
      expect((e as MissingApiKeyError).envVars).toEqual(["GROQ_API_KEY"]);
      expect((e as Error).message).toContain("GROQ_API_KEY");
    }
  });

  test("apiKey를 직접 주면 환경변수를 안 본다", () => {
    expect(model("groq/llama-3.3-70b", { env: {}, apiKey: "직접" }).provider).toBe("groq");
  });
});

describe("adapterBaseURL — 두 SDK의 baseURL 규약이 정반대다", () => {
  test("Anthropic SDK는 /v1을 스스로 붙인다 → 레지스트리 값에서 떼야 한다", () => {
    // 안 떼면 POST .../anthropic/v1/v1/messages 가 된다(실제로 있었던 버그).
    expect(adapterBaseURL("anthropic", "https://api.minimax.io/anthropic/v1")).toBe(
      "https://api.minimax.io/anthropic",
    );
    expect(adapterBaseURL("anthropic", "https://api.kimi.com/coding/v1")).toBe(
      "https://api.kimi.com/coding",
    );
    expect(adapterBaseURL("anthropic", undefined)).toBeUndefined(); // 본가는 SDK 기본값
  });

  test("OpenAI SDK는 반대 — /v1이 있어야 하므로 건드리지 않는다", () => {
    for (const url of [
      "https://openrouter.ai/api/v1",
      "https://api.groq.com/openai/v1",
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      "https://api.deepseek.com",
    ]) {
      expect(adapterBaseURL("openai", url)).toBe(url);
    }
  });

  test("**anthropic 포맷 프로바이더 전부**가 /v1 중복 없이 끝난다", () => {
    for (const id of listProviders("anthropic")) {
      const fixed = adapterBaseURL("anthropic", PROVIDERS[id]?.api);
      expect(fixed?.endsWith("/v1"), `${id}: ${fixed}`).not.toBe(true);
    }
  });
});

describe("레지스트리 — '200개 프로바이더'의 실체", () => {
  test("프로바이더는 많지만 와이어 포맷은 둘뿐이다", () => {
    const anthropic = listProviders("anthropic");
    const openai = listProviders("openai");
    const unsupported = listProviders("unsupported");

    expect(anthropic.length + openai.length).toBeGreaterThan(150); // 어댑터 2개로 덮인다
    expect(openai.length).toBeGreaterThan(anthropic.length * 10); // 압도적으로 OpenAI 호환
    expect(unsupported).toContain("amazon-bedrock"); // 서명 인증은 baseURL로 못 덮는다

    // 어댑터가 둘뿐이라는 걸 형식으로도 못박는다.
    const formats = new Set([...anthropic, ...openai].map((id) => PROVIDERS[id]?.format));
    expect([...formats].sort()).toEqual(["anthropic", "openai"]);
  });

  test("자주 쓰는 프로바이더가 실제로 들어있다", () => {
    for (const id of ["anthropic", "openai", "google", "openrouter", "groq", "deepseek", "xai"]) {
      expect(PROVIDERS[id]?.format).not.toBe("unsupported");
    }
  });

  test("모든 엔트리가 인증 방법을 안다", () => {
    for (const [id, entry] of Object.entries(PROVIDERS)) {
      expect(entry.env.length, `${id}에 env가 없다`).toBeGreaterThan(0);
    }
  });
});

// 실제 호출. 각 키가 있을 때만 돈다.
describe.skipIf(!process.env.OPENROUTER_API_KEY)("실제 OpenRouter 호출", () => {
  test("게이트웨이 너머로 진짜 응답이 온다", async () => {
    const m = model("openrouter/anthropic/claude-haiku-4.5", { maxTokens: 64 });
    const result = await m.invoke([human("'pong'이라고만 답해라.")]);
    expect(result.role).toBe("ai");
    expect(result.content.length).toBeGreaterThan(0);
  }, 60_000);
});

const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
describe.skipIf(!geminiKey)("실제 Gemini 호출 (OpenAI 호환 셰임)", () => {
  test("네이티브가 아닌 셰임 경로로도 진짜 응답이 온다", async () => {
    const m = model("google/gemini-2.5-flash", { maxTokens: 64 });
    const result = await m.invoke([human("'pong'이라고만 답해라.")]);
    expect(result.role).toBe("ai");
    expect(result.content.length).toBeGreaterThan(0);
  }, 60_000);
});
