import { useEffect, useState } from "react";
import { type AgentInfo, api, readSelection, saveSelection } from "./api";
import { useTheme } from "./theme";
import { AgentView } from "./views/AgentView";
import { EvalView } from "./views/EvalView";

function NavItem({
  active,
  onClick,
  title,
  subtitle,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  dot?: "ready" | "no";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md px-2.5 py-2 text-left font-semibold ${active ? "bg-fg text-bg" : "text-fg hover:bg-surface-2"}`}
    >
      <span className="flex items-center gap-1.5">
        {dot ? <span className={dot === "ready" ? "text-ready" : "text-warn"}>●</span> : null}
        <span className="truncate">{title}</span>
      </span>
      {subtitle ? (
        <span
          className={`mt-0.5 block truncate font-normal text-xs ${active ? "opacity-60" : "text-faint"}`}
        >
          {subtitle}
        </span>
      ) : null}
    </button>
  );
}

export function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [page, setPage] = useState<"agent" | "evals">("agent");
  const [error, setError] = useState("");
  const { theme, toggle } = useTheme();

  useEffect(() => {
    let active = true;
    api
      .agents()
      .then((list) => {
        if (!active) return;
        setAgents(list);
        const saved = readSelection("agent");
        setSelectedId(list.find((a) => a.id === saved)?.id ?? list[0]?.id);
      })
      .catch((e: unknown) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = agents.find((a) => a.id === selectedId);

  return (
    <div className="flex h-full">
      <nav className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-border border-r bg-surface px-3 py-3.5">
        <div className="px-2 pt-1 pb-0.5 font-bold text-base">
          Ariadne Studio
          <span className="mt-0.5 block font-normal text-faint text-xs">
            그래프 엔진 위에서 도는 에이전트
          </span>
        </div>

        <div className="px-2 pt-4 pb-1 font-bold text-[11px] text-faint uppercase tracking-wider">
          Agents
        </div>
        {agents.length ? (
          agents.map((a) => (
            <NavItem
              key={a.id}
              active={a.id === selectedId}
              onClick={() => {
                setPage("agent");
                setSelectedId(a.id);
                saveSelection("agent", a.id);
              }}
              title={a.name}
              subtitle={a.tools.length ? a.tools.join("·") : "툴 없음"}
              dot={a.ready ? "ready" : "no"}
            />
          ))
        ) : (
          <p className="px-2 text-faint text-xs">{error || "불러오는 중…"}</p>
        )}

        <div className="px-2 pt-4 pb-1 font-bold text-[11px] text-faint uppercase tracking-wider">
          Quality
        </div>
        <NavItem
          active={page === "evals"}
          onClick={() => setPage("evals")}
          title="Evals"
          subtitle="BFCL · Claude Code"
        />

        <button
          type="button"
          onClick={toggle}
          className="mt-auto flex items-center gap-2 rounded-md px-2.5 py-2 text-left font-semibold text-muted hover:bg-surface-2 hover:text-fg"
        >
          <span>{theme === "dark" ? "☀" : "🌙"}</span>
          <span>{theme === "dark" ? "라이트 테마" : "다크 테마"}</span>
        </button>
      </nav>

      <main className="flex-1 overflow-y-auto">
        {page === "evals" ? (
          <EvalView />
        ) : selected ? (
          <AgentView key={selected.id} agent={selected} />
        ) : null}
      </main>
    </div>
  );
}
