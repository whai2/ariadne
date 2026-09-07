import mermaid from "mermaid";
import { useEffect, useId, useState } from "react";
import type { GraphView } from "../api";
import { type Theme, useTheme } from "../theme";

// 팔레트를 CSS !important로 SVG에 덮는 대신 mermaid themeVariables로 준다(mermaid-정석).
// 테마별 두 벌 — 렌더 직전에 initialize를 다시 불러 스위칭한다(전역 config라 idempotent).
const MERMAID_VARS: Record<Theme, Record<string, string>> = {
  dark: {
    background: "#16171a",
    primaryColor: "#282b31",
    primaryTextColor: "#f3f4f6",
    primaryBorderColor: "#4b515b",
    lineColor: "#8b909c",
  },
  light: {
    background: "#ffffff",
    primaryColor: "#eceef2",
    primaryTextColor: "#1b1e24",
    primaryBorderColor: "#c4c8d2",
    lineColor: "#868d99",
  },
};

function label(n: string): string {
  return n === "__start__" ? "START" : n === "__end__" ? "END" : n;
}

// 조건부 엣지는 점선 — 라우터가 런타임에 고르는 길이라 항상 가는 게 아니다(S6).
function toMermaid(g: GraphView): string {
  const lines = ["graph TD"];
  for (const e of g.edges) {
    const arrow = e.kind === "conditional" ? " -.-> " : " --> ";
    lines.push(`  ${e.from}["${label(e.from)}"]${arrow}${e.to}["${label(e.to)}"]`);
  }
  return lines.join("\n");
}

export function Graph({ graph }: { graph: GraphView | { error: string } | null }) {
  const [svg, setSvg] = useState("");
  const { theme } = useTheme();
  const rawId = useId();
  const id = `m${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    if (!graph || "error" in graph) {
      setSvg("");
      return;
    }
    let cancelled = false;
    // 렌더 직전 테마에 맞춰 재-init — 다크↔라이트 토글 시 노드/글자/엣지 색이 따라온다.
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "loose",
      themeVariables: { ...MERMAID_VARS[theme], fontFamily: "ui-monospace, monospace" },
    });
    mermaid
      .render(id, toMermaid(graph))
      .then((r) => {
        if (!cancelled) setSvg(r.svg);
      })
      .catch(() => {
        if (!cancelled) setSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [graph, id, theme]);

  if (graph && "error" in graph) {
    return <div className="font-mono text-danger text-xs">{graph.error}</div>;
  }
  if (!svg) return <div className="text-muted text-xs">그래프 그리는 중…</div>;
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid가 만든 신뢰 SVG다.
    <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
