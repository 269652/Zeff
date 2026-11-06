"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { undoAction } from "../actions";
import { askWorkspace } from "./chat-client";
import { answerFits, routeAiEntry, type AiChip, type WriteMode } from "../ai-entry";
import type { ChatStep } from "../agent";
import { handToChat, WS_CHANGED } from "./ChatPanel";
import { Modal } from "./kit";

/**
 * The page's one ✨ entry (the top bar's ✨, the block's ✨ in the gutter, Ctrl+Shift+Space, an empty line's ✨): one field —
 * "What should Zeff do?" — and three chips. Think along puts its card into the page (assist-node.tsx), Write writes with the
 * editor's AI modes (or as told), Ask about this page answers here — a long answer goes on in the chat panel. ai-entry.ts routes.
 */
export function AiComposer({ pageId, scope, chip: firstChip = null, onThink, onWrite, onClose }: { pageId: number; scope: "block" | "page"; chip?: AiChip | null; onThink: (wish: string) => void; onWrite: (mode: WriteMode | "custom", instruction?: string) => void; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [chip, setChip] = useState<AiChip | null>(firstChip);
  const [mode, setMode] = useState<WriteMode>("continue");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ question: string; reply: string; steps: ChatStep[]; undoId?: number | null; undone?: boolean } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const route = routeAiEntry(text, chip, mode);
  const MODES: [WriteMode, string][] = [
    ["continue", t("Continue writing")],
    ["summarize", t("Summarize the page")],
    ["actions", t("List the tasks")],
    ["improve", t("Improve")],
    ["shorter", t("Shorter")],
    ["longer", t("Longer")],
    ["explain", t("Explain")],
    ["fix", t("Spelling")],
    ["translate_en", `${t("Translate")} EN`],
    ["translate_de", `${t("Translate")} DE`],
    ["translate_es", `${t("Translate")} ES`],
  ];
  const CHIPS: [AiChip, string, string][] = [
    ["think", t("Think along"), t("Understands it, asks what is missing, proposes what to set up — nothing happens until you apply it")],
    ["write", t("Write …"), t("Writes into the page: continues, summarizes, improves — or what you type")],
    ["ask", t("Ask about this page"), t("Answers here; it can also change the workspace (Undo takes it back)")],
  ];

  const ask = async (question: string) => {
    setBusy(true);
    try {
      const r = await askWorkspace([{ role: "user", text: question }], pageId);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      if (r.changed) {
        router.refresh();
        window.dispatchEvent(new Event(WS_CHANGED));
      }
      const reply = r.reply || t("Done.");
      if (answerFits(reply)) return void setAnswer({ question, reply, steps: r.steps, undoId: r.undoId });
      // Long: read (and talked on) in the chat panel.
      handToChat([{ role: "user", text: question }, { role: "assistant", text: reply, steps: r.steps, undoId: r.undoId }]);
      toast(t("The answer is in the chat (sidebar)."), { tone: "ok" });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const go = (r = route) => {
    if (!r || busy) return;
    if (r.kind === "think") return onThink(r.wish);
    if (r.kind === "write") return onWrite(r.mode as WriteMode | "custom", r.instruction);
    void ask(r.question);
  };

  const pick = (c: AiChip) => {
    const next = chip === c ? null : c;
    setChip(next);
    // Think along needs nothing more: it starts (with what is typed, if anything).
    if (next === "think") return go(routeAiEntry(text, "think"));
    field.current?.focus();
  };

  const verb = !route ? t("Ask") : route.kind === "think" ? t("Think along") : route.kind === "write" ? t("Write") : t("Ask");
  return (
    <Modal title={`✨ ${scope === "page" ? t("Zeff on this page") : t("Zeff on this block")}`} onClose={onClose}>
      <form
        className="space-y-2"
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <textarea
          ref={field}
          autoFocus
          rows={2}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              go();
            }
          }}
          aria-label={t("What should Zeff do?")}
          aria-describedby="ai-composer-hint"
          className="input w-full"
          placeholder={t("What should Zeff do? (write, plan, ask …)")}
        />
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("What Zeff does")}>
          {CHIPS.map(([c, label, title]) => (
            <button key={c} type="button" className="ws-assist-chip" aria-pressed={chip === c} title={title} disabled={busy} onClick={() => pick(c)}>
              {label}
            </button>
          ))}
          {chip === "write" && !text.trim() && (
            <select className="input input-sm" value={mode} aria-label={t("What to write")} onChange={(e) => setMode(e.target.value as WriteMode)}>
              {MODES.map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p id="ai-composer-hint" className="flex-1 text-xs text-zinc-500">
            {!route ? t("Type your question.") : route.kind === "think" ? t("Enter: think along — it asks what is missing, then proposes.") : route.kind === "write" ? t("Enter: write into the page (Ctrl+Z takes it back).") : t("Enter: ask about this page — the answer shows here.")}
          </p>
          <button className="btn btn-primary btn-sm" disabled={busy || !route}>
            {busy ? t("The AI is working …") : `✨ ${verb}`}
          </button>
        </div>
      </form>
      {answer && (
        <div className="space-y-2 rounded-lg border border-violet-200 p-2 text-sm dark:border-violet-900/60" role="status" aria-live="polite">
          <p className="text-xs text-zinc-500">{answer.question}</p>
          <div className="whitespace-pre-wrap" data-ai-answer="">
            {answer.reply}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                handToChat([{ role: "user", text: answer.question }, { role: "assistant", text: answer.reply, steps: answer.steps, undoId: answer.undone ? null : answer.undoId }]);
                onClose();
              }}
            >
              {t("Continue in the chat")}
            </button>
            {answer.undoId && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={answer.undone}
                onClick={async () => {
                  const u = await undoAction(answer.undoId!);
                  if (!u.ok) return void toast(u.error, { tone: "error" });
                  setAnswer({ ...answer, undone: true });
                  router.refresh();
                  window.dispatchEvent(new Event(WS_CHANGED));
                }}
              >
                ↩ {answer.undone ? t("undone") : t("Undo what this answer changed")}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
