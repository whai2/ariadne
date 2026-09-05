// models.dev 레지스트리 → `src/registry.generated.ts` 생성기.
//
//   bun run --filter '@ariadne/model' sync
//
// **빌드타임에만 돈다.** 생성물은 커밋되므로 런타임엔 네트워크가 없고, 오프라인에서도
// 테스트가 그린이다. (Mastra는 런타임에 fetch한다 — 우리는 그 반대 트레이드오프를 골랐다.)
//
// 왜 이게 가능한가: 프로바이더가 200개를 넘어도 **와이어 포맷은 몇 개 안 된다.**
// 대부분이 OpenAI 호환 엔드포인트라, 어댑터는 그대로 두고 baseURL만 바꾸면 된다.

const REGISTRY_URL = "https://models.dev/api.json";
const OUT = new URL("../src/registry.generated.ts", import.meta.url);

/**
 * **손으로 검증한 오버라이드.**
 *
 * models.dev의 `npm` 필드는 *와이어 포맷*이 아니라 "Vercel AI SDK에서 어느 패키지를 쓰나"를
 * 가리킨다. 그래서 엔드포인트는 멀쩡히 OpenAI 호환인데 전용 패키지가 있다는 이유로
 * 자동 분류가 unsupported로 떨어지는 프로바이더가 생긴다 — OpenRouter가 대표적이다.
 *
 * 여기 있는 것들은 각 프로바이더 문서에서 "OpenAI SDK에 baseURL만 바꿔 끼우면 된다"를
 * 확인한 것만 넣는다. api가 비어 있으면 문서에 적힌 베이스 URL을 같이 적는다.
 */
const OVERRIDES: Record<string, { format: "openai"; api?: string }> = {
  openrouter: { format: "openai", api: "https://openrouter.ai/api/v1" },
  groq: { format: "openai", api: "https://api.groq.com/openai/v1" },
  xai: { format: "openai", api: "https://api.x.ai/v1" },
  cerebras: { format: "openai", api: "https://api.cerebras.ai/v1" },
  mistral: { format: "openai", api: "https://api.mistral.ai/v1" },
  togetherai: { format: "openai", api: "https://api.together.ai/v1" },
  perplexity: { format: "openai", api: "https://api.perplexity.ai" },
  deepinfra: { format: "openai", api: "https://api.deepinfra.com/v1/openai" },
  venice: { format: "openai", api: "https://api.venice.ai/api/v1" },
  vercel: { format: "openai", api: "https://ai-gateway.vercel.sh/v1" },
  // Cohere는 네이티브 API가 따로 있고, 그와 별개로 "Compatibility API"를 낸다.
  cohere: { format: "openai", api: "https://api.cohere.ai/compatibility/v1" },
  // Gemini는 **네이티브 포맷이 진짜로 다르다**(generateContent · contents/parts ·
  // systemInstruction). 그런데 구글이 OpenAI 호환 **셰임 엔드포인트**를 공식 제공한다.
  // 끝 슬래시는 구글 문서 그대로다(SDK가 정규화하므로 이중 슬래시는 안 생긴다).
  // 주의: 이 셰임은 모르는 파라미터를 **조용히 무시**한다 — 에러가 아니라 무시다.
  google: { format: "openai", api: "https://generativelanguage.googleapis.com/v1beta/openai/" },
};

/** models.dev의 npm 필드 → 우리가 가진 어댑터. 모르는 건 정직하게 unsupported. */
function toFormat(npm: string | undefined): "anthropic" | "openai" | "unsupported" {
  if (npm === "@ai-sdk/anthropic") return "anthropic";
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/openai-compatible") return "openai";
  return "unsupported";
}

interface RawProvider {
  id?: string;
  name?: string;
  npm?: string;
  api?: string | null;
  env?: string[];
  models?: Record<string, unknown>;
}

const res = await fetch(REGISTRY_URL);
if (!res.ok) throw new Error(`models.dev 응답 ${res.status}`);
const raw = (await res.json()) as Record<string, RawProvider>;

const rows = Object.entries(raw)
  .map(([id, p]) => {
    const override = OVERRIDES[id];
    return {
      id,
      name: p.name ?? id,
      format: override?.format ?? toFormat(p.npm),
      api: override?.api ?? p.api ?? undefined,
      env: p.env ?? [],
      npm: p.npm ?? "",
      models: Object.keys(p.models ?? {}).length,
    };
  })
  .filter((r) => r.env.length > 0) // 인증 방법을 모르면 우리가 부를 수 없다
  .sort((a, b) => a.id.localeCompare(b.id));

const counts = { anthropic: 0, openai: 0, unsupported: 0 };
for (const r of rows) counts[r.format] += 1;

/**
 * baseURL이 `https://${DATABRICKS_HOST}/...`처럼 **환경변수로 조립되는** 프로바이더가 있다.
 * models.dev가 그 자리를 `${VAR}`로 표기해 두므로 변수 이름을 뽑아 둔다.
 *
 * 이걸 안 읽으면 두 가지가 조용히 깨진다:
 *   1. baseURL에 `${...}`가 그대로 남아 요청이 엉뚱한 데로 간다
 *   2. `env` 목록의 첫 값을 API 키로 집는데, 그게 **URL 조각**일 수 있다
 */
function apiVarsOf(api: string | undefined): string[] {
  return [...(api ?? "").matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1] as string);
}

const q = (s: string) => JSON.stringify(s);
const body = rows
  .map((r) => {
    const apiVars = apiVarsOf(r.api);
    const parts = [`format: ${q(r.format)}`, `name: ${q(r.name)}`];
    if (r.api !== undefined) parts.push(`api: ${q(r.api)}`);
    if (apiVars.length > 0) parts.push(`apiVars: [${apiVars.map(q).join(", ")}]`);
    parts.push(`env: [${r.env.map(q).join(", ")}]`);
    if (r.format === "unsupported") parts.push(`npm: ${q(r.npm)}`);
    return `  ${JSON.stringify(r.id)}: { ${parts.join(", ")} },`;
  })
  .join("\n");

const file = `// 이 파일은 **생성물이다. 직접 고치지 말 것.**
//   bun run --filter '@ariadne/model' sync
// 원본: ${REGISTRY_URL} (models.dev)
//
// 프로바이더 ${rows.length}개 · 모델 ${rows.reduce((n, r) => n + r.models, 0)}개 시점 스냅샷.
// 포맷 분포: anthropic ${counts.anthropic} · openai 호환 ${counts.openai} · 미지원 ${counts.unsupported}
//
// "프로바이더 200개 지원"의 실체가 이 표다 — 어댑터는 둘뿐이고, 나머지는 baseURL과 env 이름이다.

import type { ProviderEntry } from "./registry";

export const PROVIDERS: Record<string, ProviderEntry> = {
${body}
};
`;

await Bun.write(OUT, file);
console.log(
  `${rows.length}개 프로바이더 생성 → src/registry.generated.ts\n` +
    `  anthropic ${counts.anthropic} · openai 호환 ${counts.openai} · 미지원 ${counts.unsupported}`,
);
