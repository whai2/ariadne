import mermaid from "mermaid";
import { useEffect, useId, useState } from "react";
import type { GraphView } from "../api";
import { type Theme, useTheme } from "../theme";

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

function toMermaid(g: GraphView, activeNodes: readonly string[]): string {
  const lines = ["graph TD"];
  for (const e of g.edges) {
    const arrow = e.kind === "conditional" ? " -.-> " : " --> ";
    lines.push(`  ${e.from}["${label(e.from)}"]${arrow}${e.to}["${label(e.to)}"]`);
  }
  if (activeNodes.length > 0) {
    lines.push("  classDef active fill:#a5a6ff,stroke:#ffffff,stroke-width:3px,color:#16171a");
    lines.push(`  class ${activeNodes.join(",")} active`);
  }
  return lines.join("\n");
}

export function Graph({
  graph,
  activeNodes = [],
}: {
  graph: GraphView | { error: string } | null;
  activeNodes?: readonly string[];
}) {
  const [svg, setSvg] = useState("");
  const { theme } = useTheme();
  const rawId = useId();
  const id = `m${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const activeKey = activeNodes.join(",");

  useEffect(() => {
    if (!graph || "error" in graph) {
      setSvg("");
      return;
    }
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "loose",
      themeVariables: { ...MERMAID_VARS[theme], fontFamily: "ui-monospace, monospace" },
    });
    mermaid
      .render(id, toMermaid(graph, activeKey === "" ? [] : activeKey.split(",")))
      .then((r) => {
        if (!cancelled) setSvg(r.svg);
      })
      .catch(() => {
        if (!cancelled) setSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [graph, id, theme, activeKey]);

  if (graph && "error" in graph) {
    return <div className="font-mono text-danger text-xs">{graph.error}</div>;
  }
  if (!svg) return <div className="text-muted text-xs">그래프 그리는 중…</div>;
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid가 만든 신뢰 SVG다.
    <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
