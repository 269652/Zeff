"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";
import type { WidgetMessage } from "@/lib/widgets/sandbox";
import { chatSendAction } from "@/app/chat/actions";
import { resultMessage } from "../result-message";

/** A result without `done`: sent to the teacher once the widget has been quiet this long. */
const QUIET_MS = 10_000;

type W = { id: number; title: string; html: string; libs: string[]; bestScore: number | null };

/**
 * The lesson's widgets: the newest one large (the teacher just made it), the earlier ones a tap away. A result the
 * widget reports is kept (its best) and worth experience — a short note says how much. And it goes to the teacher
 * (`sessionRunId`, the lesson's chat) so the lesson goes on by itself: at once when the widget says it's done, else
 * when it has been quiet for a while.
 */
export function LessonWidgets({ widgets, sessionRunId }: { widgets: W[]; sessionRunId?: number }) {
  const t = useT();
  const router = useRouter();
  const [shown, setShown] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const tellTeacher = (title: string, r: Extract<WidgetMessage, { type: "result" }>) => {
    if (timer.current) clearTimeout(timer.current);
    if (!sessionRunId) return;
    const send = async () => {
      timer.current = null;
      const res = await chatSendAction({ text: resultMessage(title, r), runId: sessionRunId });
      if (!res.ok) toast(res.error, { tone: "error" });
      router.refresh();
    };
    if (r.done) void send();
    else timer.current = setTimeout(() => void send(), QUIET_MS);
  };
  if (!widgets.length) return null;
  const current = widgets.find((w) => w.id === shown) ?? widgets[widgets.length - 1];
  return (
    <section className="space-y-2" aria-label={t("Widgets")}>
      {widgets.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t("Widgets of this lesson")}>
          {widgets.map((w) => (
            <button key={w.id} type="button" role="tab" aria-selected={w.id === current.id} className={`btn btn-sm shrink-0 ${w.id === current.id ? "btn-primary" : ""}`} onClick={() => setShown(w.id)}>
              {w.title}
              {w.bestScore !== null && <span className="ml-1 opacity-75">{Math.round(w.bestScore * 100)}%</span>}
            </button>
          ))}
        </div>
      )}
      <WidgetFrame
        key={current.id}
        html={current.html}
        libs={current.libs}
        title={current.title}
        onResult={async (r) => {
          const res = await postJson<{ xp: number; best: number }>(`/api/learn/widgets/${current.id}/result`, r).catch(() => null);
          if (res && res.xp > 0) toast(t("+{xp} XP — {title}", { xp: res.xp, title: current.title }), { tone: "ok" });
          if (r.type === "result") tellTeacher(current.title, r);
          router.refresh();
        }}
      />
    </section>
  );
}
