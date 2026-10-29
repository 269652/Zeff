"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { undoAction, workspaceChatAction } from "../actions";
import type { ChatStep } from "../agent";

/** Tell this to the editors and databases on screen: the workspace was changed by the assistant - read it again. */
export const WS_CHANGED = "ws-changed";

export type Msg = { role: "user" | "assistant"; text: string; steps?: ChatStep[]; error?: boolean; /** The history entry of what this answer changed (Undo). */ undoId?: number | null; undone?: boolean };

/** A talk begun in the page's ✨ composer (ai-composer.tsx) goes on here: the panel opens with it. */
const WS_CHAT = "ws-chat";
export const handToChat = (msgs: Msg[]) => window.dispatchEvent(new CustomEvent<Msg[]>(WS_CHAT, { detail: msgs }));

const KEY = "zeff.workspace.chat";
const OPEN = "zeff.workspace.chat.open";

const read = <T,>(k: string, fallback: T, store: Storage | undefined): T => {
  try {
    const v = store?.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

/**
 * The assistant in the sidebar: say what should happen in the workspace - add rows, change a view, write an article, remove a
 * column - and the AI does it with the workspace tools, then tells what it did. The page you are on is its "here".
 */
export function ChatPanel() {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const pageId = Number(/^\/workspace\/(\d+)/.exec(path)?.[1] ?? 0) || undefined;
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the talk and whether the panel is open are remembered in the browser
    setMsgs(read<Msg[]>(KEY, [], typeof sessionStorage === "undefined" ? undefined : sessionStorage));
    setOpen(read<boolean>(OPEN, false, typeof localStorage === "undefined" ? undefined : localStorage));
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40)));
    } catch {
      // not remembered
    }
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

  const show = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(OPEN, JSON.stringify(v));
    } catch {
      // not remembered
    }
  };
  const toggle = () => show(!open);

  useEffect(() => {
    const take = (e: Event) => {
      const more = (e as CustomEvent<Msg[]>).detail;
      if (!Array.isArray(more)) return;
      setMsgs((cur) => [...cur, ...more]);
      show(true);
    };
    window.addEventListener(WS_CHAT, take);
    return () => window.removeEventListener(WS_CHAT, take);
  }, []);

  const send = async (said: string) => {
    const v = said.trim();
    if (!v || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: v }];
    setMsgs(next);
    setText("");
    setBusy(true);
    try {
      const r = await workspaceChatAction(next.map((m) => ({ role: m.role, text: m.text })), pageId);
      if (!r.ok) setMsgs([...next, { role: "assistant", text: r.error, error: true }]);
      else {
        setMsgs([...next, { role: "assistant", text: r.reply || t("Done."), steps: r.steps, undoId: r.undoId }]);
        if (r.changed) {
          router.refresh();
          window.dispatchEvent(new Event(WS_CHANGED));
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
      setMsgs([...next, { role: "assistant", text: t("That didn't work."), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const examples = [t("Add a row: …"), t("Change this database to a board"), t("Write an article about …"), t("Remove the empty columns")];

  return (
    <section className="rounded-lg border border-violet-200 dark:border-violet-900/60">
      <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm font-medium text-violet-700 dark:text-violet-300" onClick={toggle} aria-expanded={open}>
        <span aria-hidden>✨</span>
        <span className="flex-1">{t("Workspace assistant")}</span>
        <span className="text-xs text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-violet-100 p-2 dark:border-violet-900/40">
          {/* No scrollbar of its own: the sidebar scrolls (one scrollbar), the message field below stays in view. */}
          <div className="min-h-16 space-y-2 text-sm">
            {!msgs.length && (
              <div className="space-y-1.5">
                <p className="text-xs text-zinc-500">{t("Tell the AI what to do with the workspace — it works on the page you have open, or on any page and database.")}</p>
                <div className="flex flex-wrap gap-1">
                  {examples.map((e) => (
                    <button key={e} type="button" className="rounded-full border border-violet-200 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950" onClick={() => setText(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ml-6 rounded-lg bg-violet-50 px-2 py-1.5 whitespace-pre-wrap dark:bg-violet-950/40" : `mr-2 space-y-1 ${m.error ? "text-red-600 dark:text-red-400" : ""}`}>
                {m.role === "assistant" && m.steps && m.steps.length > 0 && (
                  <details className="text-xs text-zinc-500">
                    <summary className="cursor-pointer">{m.steps.length === 1 ? t("1 step") : t("{n} steps", { n: m.steps.length })}</summary>
                    <ul className="mt-1 space-y-0.5">
                      {m.steps.map((s, j) => (
                        <li key={j} className={s.ok ? "" : "text-red-600 dark:text-red-400"}>
                          {s.ok ? "✓" : "✗"} <span className="font-mono">{s.tool.replace(/^workspace_/, "")}</span> — {s.summary}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.role === "assistant" && m.undoId && (
                  <button
                    type="button"
                    className="text-xs text-zinc-500 hover:underline disabled:opacity-50"
                    disabled={m.undone}
                    onClick={async () => {
                      const u = await undoAction(m.undoId!);
                      if (!u.ok) return void toast(u.error, { tone: "error" });
                      setMsgs((cur) => cur.map((x, j) => (j === i ? { ...x, undone: true } : x)));
                      router.refresh();
                      window.dispatchEvent(new Event(WS_CHANGED));
                    }}
                  >
                    ↩ {m.undone ? t("undone") : t("Undo what this answer changed")}
                  </button>
                )}
              </div>
            ))}
            {busy && <p className="text-xs text-violet-700 dark:text-violet-300">✨ {t("The AI is working …")}</p>}
            <div ref={end} />
          </div>
          <form
            className="sticky bottom-0 -mx-2 -mb-2 space-y-1 rounded-b-lg border-t border-violet-100 px-2 pt-1.5 pb-2 dark:border-violet-900/40"
            style={{ background: "var(--background)" }}
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              rows={3}
              className="input w-full text-sm"
              placeholder={t("What should the AI do? (Enter sends, Shift+Enter: new line)")}
              aria-label={t("Message to the assistant")}
              disabled={busy}
            />
            <div className="flex items-center justify-between">
              <button type="button" className="text-xs text-zinc-500 hover:underline" disabled={busy || !msgs.length} onClick={() => setMsgs([])}>
                {t("New chat")}
              </button>
              <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
                {t("Send")}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
