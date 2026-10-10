"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { addKnowledgeAction } from "./add-actions";

/** "Merken": something into the knowledge — a fact, a note, a link (its page read); compiled right after. */
export function KnowledgeAdd() {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const save = () =>
    text.trim() &&
    start(async () => {
      const r = await addKnowledgeAction(text);
      if (!r.ok) return toast(r.error ?? "Ging nicht.", { tone: "error" });
      toast(`Gemerkt: „${r.title ?? text.slice(0, 40)}“ — wird kompiliert.`, { tone: "ok" });
      setText("");
    });
  return (
    <div className="space-y-1.5">
      <label htmlFor="knowledge-add" className="text-xs font-semibold text-zinc-500 uppercase">
        Wissen hinzufügen
      </label>
      <textarea
        id="knowledge-add"
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}
        rows={3}
        placeholder="Ein Fakt, eine Notiz, wie etwas geht — oder ein Link"
        className="input resize-y text-sm"
      />
      <button type="button" className="btn btn-sm" disabled={pending || !text.trim()} onClick={save}>
        {pending ? "Merkt …" : "Merken"}
      </button>
    </div>
  );
}
