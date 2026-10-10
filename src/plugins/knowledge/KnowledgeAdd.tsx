"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { addKnowledgeAction } from "./add-actions";

/** "Remember": something into the knowledge — a fact, a note, a link (its page read); compiled right after. */
export function KnowledgeAdd() {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const save = () =>
    text.trim() &&
    start(async () => {
      const r = await addKnowledgeAction(text);
      if (!r.ok) return toast(r.error ?? "That didn't work.", { tone: "error" });
      toast(`Remembered: “${r.title ?? text.slice(0, 40)}” — being compiled.`, { tone: "ok" });
      setText("");
    });
  return (
    <div className="space-y-1.5">
      <label htmlFor="knowledge-add" className="text-xs font-semibold text-zinc-500 uppercase">
        Add knowledge
      </label>
      <textarea
        id="knowledge-add"
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}
        rows={3}
        placeholder="A fact, a note, how something works — or a link"
        className="input resize-y text-sm"
      />
      <button type="button" className="btn btn-sm" disabled={pending || !text.trim()} onClick={save}>
        {pending ? "Remembering …" : "Remember"}
      </button>
    </div>
  );
}
