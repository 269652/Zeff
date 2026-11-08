"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";

type W = { id: number; title: string; html: string; libs: string[]; bestScore: number | null };

/**
 * The lesson's widgets: the newest one large (the teacher just made it), the earlier ones a tap away. A result the
 * widget reports is kept (its best) and worth experience — a short note says how much.
 */
export function LessonWidgets({ widgets }: { widgets: W[] }) {
  const t = useT();
  const router = useRouter();
  const [shown, setShown] = useState<number | null>(null);
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
          router.refresh();
        }}
      />
    </section>
  );
}
