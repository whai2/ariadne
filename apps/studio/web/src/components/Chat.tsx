import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Message } from "../api";

const ROLE_COLOR: Record<string, string> = {
  human: "text-human",
  ai: "text-aimsg",
  tool: "text-tool",
};

function Bubble({ m }: { m: Message }) {
  const err = m.status === "error";
  const who = m.role + (m.toolCallId ? ` → #${m.toolCallId}` : "");
  return (
    <div className="mb-3">
      <div
        className={`mb-0.5 font-bold text-[11px] uppercase tracking-wide ${err ? "text-danger" : (ROLE_COLOR[m.role] ?? "text-muted")}`}
      >
        {who}
        {err ? " ✗" : ""}
      </div>
      {m.content ? (
        <div className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>
      ) : null}
      {(m.toolCalls ?? []).map((c) => (
        <div key={c.id} className="mt-1 font-mono text-tool text-xs">
          🔧 {c.name}({JSON.stringify(c.args)}) #{c.id}
        </div>
      ))}
    </div>
  );
}

export function ChatLog({
  messages,
  pending,
  empty,
}: {
  messages: Message[];
  pending?: boolean;
  empty: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pending 변화에도 맨 아래로 스크롤한다.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages, pending]);

  const isEmpty = messages.length === 0 && !pending;
  return (
    <div
      ref={ref}
      className="h-[340px] overflow-y-auto rounded-md border border-border bg-bg/40 p-3"
    >
      {isEmpty ? (
        <p className="text-muted text-xs">{empty}</p>
      ) : (
        messages.map((m, i) => <Bubble key={m.id ?? i} m={m} />)
      )}
      {pending ? (
        <div className="mb-3">
          <div className="mb-0.5 font-bold text-[11px] text-aimsg uppercase tracking-wide">ai</div>
          <div className="text-muted">생각 중…</div>
        </div>
      ) : null}
    </div>
  );
}

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  function fire() {
    const t = text.trim();
    if (!t || disabled) return;
    setText("");
    onSend(t);
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // IME 조합 중 Enter는 무시한다(한글 입력에서 확정 Enter가 전송까지 트리거하는 것 방지).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      fire();
    }
  }
  return (
    <div className="mt-2.5 flex gap-2">
      <textarea
        className="flex-1 resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-fg outline-none focus:border-accent"
        rows={2}
        placeholder="메시지를 입력하고 Enter (Shift+Enter 줄바꿈)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={fire}
        className="shrink-0 rounded-md bg-accent px-4 font-semibold text-bg disabled:opacity-50"
      >
        보내기
      </button>
    </div>
  );
}
