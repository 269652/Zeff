"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";
import type { WidgetMessage } from "@/lib/widgets/sandbox";
import { chatSendAction } from "@/app/chat/actions";
import { errorMessage, resultMessage } from "../result-message";

/** A result without `done`: sent to the teacher once the widget has been quiet this long. */
const QUIET_MS = 10_000;

type Result = Extract<WidgetMessage, { type: "result" }>;

/**
 * What happens to a widget's result: kept (its best, every try with its answers) and worth experience — a short note
 * says how much; and it goes to the teacher (`sessionRunId`, the lesson's chat), so the lesson goes on by itself: at
 * once when the widget says it's done, else when it has been quiet for a while.
 */
export function useWidgetResults(sessionRunId?: number): (w: { id: number; title: string }, r: Result) => Promise<void> {
  const t = useT();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return async (w, r) => {
    const res = await postJson<{ xp: number; best: number; told?: boolean }>(`/api/learn/widgets/${w.id}/result`, r).catch(() => null);
    if (res && res.xp > 0) toast(t("+{xp} XP — {title}", { xp: res.xp, title: w.title }), { tone: "ok" });
    router.refresh();
    if (timer.current) clearTimeout(timer.current);
    if (!sessionRunId) return;
    const send = async () => {
      timer.current = null;
      const sent = await chatSendAction({ text: resultMessage(w.title, r), runId: sessionRunId });
      if (!sent.ok) toast(sent.error, { tone: "error" });
      router.refresh();
    };
    // Finished: the server told the teacher with the result (told) — only if it couldn't, from here.
    if (r.done) {
      if (!res?.told) void send();
    }
    else timer.current = setTimeout(() => void send(), QUIET_MS);
  };
}

/**
 * Something broke in a widget: the teacher hears of it (once per widget and message on this page) and sends a fixed one;
 * the widget shows its own friendly note meanwhile.
 */
export function useWidgetErrors(sessionRunId?: number): (w: { id: number; title: string }, message: string) => void {
  const router = useRouter();
  const told = useRef(new Set<string>());
  return (w, message) => {
    const key = `${w.id}:${message}`;
    if (!sessionRunId || told.current.has(key) || told.current.size > 20) return;
    told.current.add(key);
    void chatSendAction({ text: errorMessage(w.title, w.id, message), runId: sessionRunId }).then(() => router.refresh());
  };
}
