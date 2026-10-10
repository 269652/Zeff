"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { createBoardAction } from "./actions";
import { BOARD_COLORS } from "./shared";
import { boardDot } from "./colors";

/** A new board of your own: name, colour, its columns (default Offen, In Arbeit, Erledigt). */
export function NewBoardForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [columns, setColumns] = useState("Offen, In Arbeit, Erledigt");
  const [color, setColor] = useState("indigo");
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createBoardAction({ name, description, color, columns });
          if (!r.ok) return void toast(r.error ?? "Ging nicht.", { tone: "error" });
          router.push(`/kanban/${r.id}`);
        });
      }}
    >
      <h2 className="font-medium">Neues Board</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Umzug, Garten, Nebenprojekt" required />
        </label>
        <label className="block text-sm">
          <span className="label">Spalten (durch Komma — die letzte zählt als erledigt)</span>
          <input className="input" value={columns} onChange={(e) => setColumns(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="label">Beschreibung</span>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1" role="radiogroup" aria-label="Farbe">
          {BOARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`size-5 rounded-full ${boardDot(c)} ring-offset-2 dark:ring-offset-zinc-900 ${color === c ? "ring-2 ring-zinc-500" : "opacity-60 hover:opacity-100"}`}
            />
          ))}
        </span>
        <button type="submit" className="btn btn-primary ml-auto" disabled={pending || !name.trim()}>
          Anlegen
        </button>
      </div>
    </form>
  );
}
