import { PROVIDERS } from "@ariadne/model";

export interface ProviderInfo {
  id: string;
  name: string;
  format: string;
  ready: boolean;
  need: string;
  tools: boolean;
}

function hasClaudeCli(): boolean {
  try {
    return Bun.spawnSync(["which", "claude"]).exitCode === 0;
  } catch {
    return false;
  }
}

export function statusOf(id: string, env: Record<string, string | undefined>): ProviderInfo | null {
  const entry = PROVIDERS[id];
  if (entry === undefined || entry.format === "unsupported") return null;

  const base = {
    id,
    name: entry.name,
    format: entry.format,
    tools: entry.format !== "claudeCode",
  };

  if (entry.format === "claudeCode") {
    const ready = hasClaudeCli();
    return { ...base, ready, need: ready ? "" : "`claude` CLI 설치 + 로그인" };
  }

  const apiVars = entry.apiVars ?? [];
  const keyNames = entry.env.filter((n) => !apiVars.includes(n));
  const missingKey = !keyNames.some((n) => env[n]);
  const missingCfg = apiVars.filter((n) => !env[n]);
  const sdkMayResolve = (id === "anthropic" || id === "openai") && entry.api === undefined;

  const need = [
    ...(missingKey && !sdkMayResolve ? [keyNames.join(" 또는 ")] : []),
    ...missingCfg,
  ].join(" · ");
  return { ...base, ready: need === "", need };
}
