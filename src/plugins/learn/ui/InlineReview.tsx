"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { ReviewDeck } from "./ReviewDeck";

type Card = { id: number; front: string; back: string };

/** The cards due, reviewed right where the course is (its row in the Workspace) — a button that opens the deck in place. */
export function InlineReview({ label, cards }: { label: string; cards: Card[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="w-full max-w-2xl space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("Review")}</h2>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          {t("Close")}
        </button>
      </div>
      <ReviewDeck cards={cards} />
    </div>
  );
}
