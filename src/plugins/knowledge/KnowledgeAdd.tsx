"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { addKnowledgeAction } from "./add-actions";

/** "Remember": something into the knowledge — a fact, a note, a link (its page read); compiled right after. */
export function KnowledgeAdd() {
  const t = useT();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const save = () =>
    text.trim() &&
    start(async () => {
      const r = await addKnowledgeAction(text);
      if (!r.ok) return toast(r.error ?? t("That didn't work."), { tone: "error" });
      toast(t("Remembered: “{title}” — being compiled.", { title: r.title ?? text.slice(0, 40) }), { tone: "ok" });
      setText("");
    });
  return (
    <div className="space-y-1.5">
      <label htmlFor="knowledge-add" className="text-xs font-semibold text-zinc-500 uppercase">
        {t("Add knowledge")}
      </label>
      <textarea
        id="knowledge-add"
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), save())}
        rows={3}
        placeholder={t("A fact, a note, how something works — or a link")}
        className="input resize-y text-sm"
      />
      <button type="button" className="btn btn-sm" disabled={pending || !text.trim()} onClick={save}>
        {pending ? t("Remembering …") : t("Remember")}
      </button>
    </div>
  );
}
