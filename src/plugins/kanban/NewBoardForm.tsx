"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { createBoardAction } from "./actions";
import { BOARD_COLORS } from "./shared";
import { boardDot } from "./colors";

/** A new board of your own: name, colour, its columns (default Open, In progress, Done). */
export function NewBoardForm() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [columns, setColumns] = useState(() => t("Open, In progress, Done"));
  const [color, setColor] = useState("indigo");
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createBoardAction({ name, description, color, columns });
          if (!r.ok) return void toast(r.error ?? t("That didn't work."), { tone: "error" });
          router.push(`/kanban/${r.id}`);
        });
      }}
    >
      <h2 className="font-medium">{t("New board")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="label">{t("Name")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Moving, Garden, Side project")} required />
        </label>
        <label className="block text-sm">
          <span className="label">{t("Columns (comma-separated — the last one counts as done)")}</span>
          <input className="input" value={columns} onChange={(e) => setColumns(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="label">{t("Description")}</span>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("optional")} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1" role="radiogroup" aria-label={t("Colour")}>
          {BOARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`grid size-6 place-items-center rounded-full text-[11px] leading-none font-bold text-white ${boardDot(c)} ring-offset-2 dark:ring-offset-zinc-900 ${color === c ? "ring-2 ring-zinc-600 dark:ring-zinc-300" : "opacity-60 hover:opacity-100"}`}
            >
              {color === c ? "✓" : ""}
            </button>
          ))}
        </span>
        <button type="submit" className="btn btn-primary ml-auto" disabled={pending || !name.trim()}>
          {t("Create")}
        </button>
      </div>
    </form>
  );
}
