import type { StepUpdate } from "../api";

/** 슈퍼스텝별로 실행된 노드 + 그 직후 채널 스냅샷. "상태 = 채널들"을 눈으로(S2). */
export function Steps({ steps, empty }: { steps: StepUpdate[]; empty?: string }) {
  if (!steps.length) {
    return (
      <p className="text-muted text-xs">{empty ?? "메시지를 보내면 스텝·채널이 여기 뜬다."}</p>
    );
  }
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.step} className="rounded-md border border-border bg-surface-2 p-2.5">
          <div className="font-bold text-aimsg text-xs">
            Step {s.step}: {s.nodes.join(" · ")}
          </div>
          <table className="mt-1.5 w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-faint">
                <th className="px-1.5 py-0.5 font-semibold">channel</th>
                <th className="px-1.5 py-0.5 font-semibold">type</th>
                <th className="px-1.5 py-0.5 font-semibold">state</th>
                <th className="px-1.5 py-0.5 font-semibold">value</th>
              </tr>
            </thead>
            <tbody>
              {s.channels.map((c) => (
                <tr key={c.key} className="border-border/40 border-t">
                  <td className="px-1.5 py-0.5 font-semibold">{c.key}</td>
                  <td className="px-1.5 py-0.5 font-mono text-tool">[{c.type}]</td>
                  <td className="px-1.5 py-0.5">
                    {c.available ? (
                      <span className="text-ready">● available</span>
                    ) : (
                      <span className="text-faint">○ empty</span>
                    )}
                  </td>
                  <td className="max-w-[280px] break-all px-1.5 py-0.5 font-mono text-muted">
                    {c.available ? JSON.stringify(c.value) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
