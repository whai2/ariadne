import type { EpisodeRow, InjectionOutcome, MemoryView, ScoredFact, ValueEventRow } from "../api";

/** 추상화 수준 — F4.0이 **행동을 가르는 축**으로 실측한 것. 형식(서술/명령)은 무관했다. */
const LEVEL: Record<ScoredFact["level"], { label: string; cls: string }> = {
  episodic: { label: "사건", cls: "bg-surface-2 text-faint" },
  preference: { label: "선호", cls: "bg-aimsg/15 text-aimsg" },
  rule: { label: "규칙", cls: "bg-tool/15 text-tool" },
};

/** 주입 한 번의 판정. `neutral`이 따로 있는 게 핵심 — **게이트의 공을 기억의 공으로 세지 않는다.** */
export const OUTCOME: Record<InjectionOutcome, { label: string; cls: string }> = {
  reinforce: { label: "강화 · 대상 툴을 안 불렀다", cls: "text-ready" },
  decay: { label: "쇠퇴 · 그냥 불렀다", cls: "text-danger" },
  neutral: { label: "중립 · 게이트가 막았다(기억의 공이 아니다)", cls: "text-warn" },
};

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

function Strength({ value }: { value: number }) {
  const cls = value > 0 ? "text-ready" : value < 0 ? "text-danger" : "text-faint";
  return <span className={`font-mono font-bold ${cls}`}>{value > 0 ? `+${value}` : value}</span>;
}

function Facts({ facts, injectedId }: { facts: ScoredFact[]; injectedId?: number }) {
  if (!facts.length) {
    return (
      <p className="text-muted text-xs">
        아직 없다. 한 툴을 <b>2번 이상 거부</b>하고 거부가 승인보다 많아지면 사실이 굳는다.
      </p>
    );
  }
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="text-left text-faint">
          <th className="px-1.5 py-0.5 font-semibold">문장</th>
          <th className="px-1.5 py-0.5 font-semibold">수준</th>
          <th className="px-1.5 py-0.5 font-semibold">대상</th>
          <th className="px-1.5 py-0.5 font-semibold">근거</th>
          <th className="px-1.5 py-0.5 text-right font-semibold">시행</th>
          <th className="px-1.5 py-0.5 text-right font-semibold">성적</th>
        </tr>
      </thead>
      <tbody>
        {facts.map((f) => (
          <tr
            key={f.id}
            className={`border-border/40 border-t ${f.id === injectedId ? "bg-aimsg/10" : ""}`}
          >
            <td className="px-1.5 py-1">
              {f.id === injectedId ? <span className="mr-1">🧠</span> : null}
              {f.text}
            </td>
            <td className="px-1.5 py-1">
              <span className={`rounded-full px-1.5 py-0.5 font-mono ${LEVEL[f.level].cls}`}>
                {LEVEL[f.level].label}
              </span>
            </td>
            <td className="px-1.5 py-1 font-mono text-tool">{f.target}</td>
            <td className="px-1.5 py-1 font-mono text-faint">{f.origin}</td>
            <td className="px-1.5 py-1 text-right font-mono text-muted">{f.trials}</td>
            <td className="px-1.5 py-1 text-right">
              <Strength value={f.strength} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Events({ events }: { events: ValueEventRow[] }) {
  if (!events.length) {
    return <p className="text-muted text-xs">아직 없다. 승인 패널에서 버튼을 눌러야 생긴다.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {events.map((e) => (
        <span
          key={e.id}
          className={`rounded-full px-2.5 py-1 font-mono text-xs ${
            e.kind === "deny" ? "bg-danger/15 text-danger" : "bg-ready/15 text-ready"
          }`}
        >
          {e.kind === "deny" ? "거부" : "승인"} · {e.target} · {time(e.at)}
        </span>
      ))}
    </div>
  );
}

const STATUS: Record<EpisodeRow["status"], { label: string; cls: string }> = {
  running: { label: "running", cls: "text-warn" },
  completed: { label: "completed", cls: "text-ready" },
  paused: { label: "paused · 승인 대기로 끝났다", cls: "text-warn" },
};

function Episodes({ episodes }: { episodes: EpisodeRow[] }) {
  if (!episodes.length) {
    return (
      <p className="text-muted text-xs">아직 없다. 메시지를 한 번 보내면 run 하나가 남는다.</p>
    );
  }
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="text-left text-faint">
          <th className="px-1.5 py-0.5 font-semibold">#</th>
          <th className="px-1.5 py-0.5 font-semibold">시각</th>
          <th className="px-1.5 py-0.5 font-semibold">받은 이력</th>
          <th className="px-1.5 py-0.5 font-semibold">새로 낸 메시지</th>
          <th className="px-1.5 py-0.5 font-semibold">최후</th>
        </tr>
      </thead>
      <tbody>
        {episodes.map((e) => {
          let produced = 0;
          try {
            produced = (JSON.parse(e.messages) as unknown[]).length;
          } catch {
            produced = 0;
          }
          return (
            <tr key={e.id} className="border-border/40 border-t">
              <td className="px-1.5 py-1 font-mono text-faint">{e.id}</td>
              <td className="px-1.5 py-1 font-mono text-muted">{time(e.started_at)}</td>
              <td className="px-1.5 py-1 font-mono text-muted">{e.input_count}</td>
              <td className="px-1.5 py-1 font-mono text-muted">{produced}</td>
              <td className={`px-1.5 py-1 font-mono ${STATUS[e.status].cls}`}>
                {STATUS[e.status].label}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="font-bold text-aimsg text-xs">{title}</div>
      <p className="mt-0.5 mb-2 text-faint text-xs">{hint}</p>
      {children}
    </div>
  );
}

/**
 * 쌓인 기억을 그대로 보여준다 (S13).
 *
 * **층이 셋인 건 쌓이는 조건이 다르기 때문이다** — 에피소드는 매 run 무조건,
 * 가치 신호는 사람이 버튼을 눌렀을 때만, 사실은 임계를 넘었을 때만.
 */
export function Memory({ view, injectedId }: { view: MemoryView | null; injectedId?: number }) {
  if (view === null) return <p className="text-muted text-xs">불러오는 중…</p>;
  return (
    <div className="space-y-2.5">
      <Block
        title="사실 (facts) — 모델에게 실제로 가는 문장"
        hint="거부가 쌓이면 여기서 문장이 굳고, 매 턴 하나씩 시험된다. 성적은 그 시험의 누적이다."
      >
        <Facts facts={view.facts} injectedId={injectedId} />
      </Block>
      <Block
        title="가치 신호 (value_events) — 사람이 내린 결정"
        hint="해석이 하나도 안 들어간다. 거부했다는 사실만 적지, 왜 거부했는지는 안 적는다."
      >
        <Events events={view.events} />
      </Block>
      <Block
        title="에피소드 (episodes) — 겪은 일"
        hint="한 run이 하나. 멈춤(paused)과 재개는 안 잇는다 — 재개는 새 run이다."
      >
        <Episodes episodes={view.episodes} />
      </Block>
    </div>
  );
}
