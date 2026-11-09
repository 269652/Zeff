"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";
import type { WidgetMessage } from "@/lib/widgets/sandbox";
import { chatSendAction } from "@/app/chat/actions";
import { resultMessage } from "../result-message";

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
    const res = await postJson<{ xp: number; best: number }>(`/api/learn/widgets/${w.id}/result`, r).catch(() => null);
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
    if (r.done) void send();
    else timer.current = setTimeout(() => void send(), QUIET_MS);
  };
}
