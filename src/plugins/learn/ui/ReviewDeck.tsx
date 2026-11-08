"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";

type Card = { id: number; front: string; back: string };
type Grade = "again" | "hard" | "good" | "easy";

/** Flashcards due today, one at a time: think, turn over, say how well you knew it (spaced repetition plans the next). */
export function ReviewDeck({ cards }: { cards: Card[] }) {
  const t = useT();
  const router = useRouter();
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [xp, setXp] = useState(0);
  const card = cards[i];
  if (!card)
    return (
      <div className="card space-y-2 p-6 text-center">
        <p className="text-2xl" aria-hidden>
          🎉
        </p>
        <p className="font-medium">{t("All cards reviewed.")}</p>
        {xp > 0 && <p className="text-sm text-amber-600 dark:text-amber-400">{t("+{xp} XP", { xp })}</p>}
      </div>
    );
  const grade = async (g: Grade) => {
    setBusy(true);
    const r = await postJson<{ xp?: number; error?: string }>(`/api/learn/cards/${card.id}/review`, { grade: g }).catch((e): { xp?: number; error?: string } => ({ error: String(e) }));
    setBusy(false);
    if (r.error) return void toast(r.error, { tone: "error" });
    setXp((x) => x + (r.xp ?? 0));
    setOpen(false);
    setI(i + 1);
    if (i + 1 >= cards.length) router.refresh();
  };
  const grades: [Grade, string, string][] = [
    ["again", t("Again"), "text-red-700 dark:text-red-400"],
    ["hard", t("Hard"), ""],
    ["good", t("Good"), ""],
    ["easy", t("Easy"), "text-emerald-700 dark:text-emerald-400"],
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500" aria-live="polite">
        {t("Card {n} of {total}", { n: i + 1, total: cards.length })}
      </p>
      <div className="card min-h-48 space-y-4 p-6">
        <p className="text-lg whitespace-pre-wrap">{card.front}</p>
        {open && <p className="border-t border-zinc-200 pt-4 whitespace-pre-wrap text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">{card.back}</p>}
      </div>
      {open ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {grades.map(([g, label, tone]) => (
            <button key={g} type="button" className={`btn ${tone}`} disabled={busy} onClick={() => grade(g)}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="btn btn-primary w-full" onClick={() => setOpen(true)}>
          {t("Show the answer")}
        </button>
      )}
    </div>
  );
}
