"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { saveAboutMeAction } from "@/app/settings/about/actions";

/**
 * About you (lib/about-me.ts): one text, the same wherever it's edited — Settings → About me, the People app beside your
 * name, the AI settings, its page in System → Prompts. `compact`: a smaller box (the People app).
 */
export function AboutMeForm({ initial, compact = false }: { initial: string; compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [pending, start] = useTransition();
  const changed = text.trim() !== initial.trim();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveAboutMeAction(text);
          if (r && !r.ok) return void toast(r.error ?? "", { tone: "error" });
          if (r?.message) toast(r.message, { tone: "ok" });
          router.refresh();
        });
      }}
    >
      <label className="sr-only" htmlFor={compact ? "about-me-compact" : "about-me"}>
        {t("About me")}
      </label>
      <textarea
        id={compact ? "about-me-compact" : "about-me"}
        className="input w-full text-sm"
        rows={compact ? 4 : 10}
        maxLength={6000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("e.g. I teach F4 at a vocational school. I work part-time, never on Fridays. Mails from parents go first.")}
      />
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !changed}>
          {t("Save")}
        </button>
        <span className="text-xs text-zinc-500">{t("{n} / 6000 characters", { n: text.trim().length })}</span>
      </div>
    </form>
  );
}
