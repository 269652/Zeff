"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";

/** A new course: what to learn, the goal, what you know already — Claude researches it and writes the plan. */
export function NewCourseForm() {
  const t = useT();
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState("");
  const [pending, start] = useTransition();
  const examples = [t("Differential geometry"), t("French"), t("Music theory"), t("Machine learning")];
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          // Through a route (not a Server Action): it answers even from a page opened before Zeff was rebuilt — and
          // whatever goes wrong (no connection to the PC, a server error) is said, never swallowed.
          const r = await postJson<{ ok: true; id: number } | { ok: false; error: string }>("/api/learn/courses", { topic, goal, level }).catch(
            (e: unknown) => ({ ok: false as const, error: `${t("Couldn't reach Zeff — check the connection and try again.")} (${e instanceof Error ? e.message : String(e)})` }),
          );
          if (!r || !r.ok) return void toast(r?.error ?? t("Didn't work."), { tone: "error" });
          router.push(`/learn/${r.id}`);
        });
      }}
    >
      <h2 className="text-base font-semibold">{t("Learn something new")}</h2>
      <label className="block">
        <span className="label">{t("Topic")}</span>
        <input className="input w-full" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("e.g. differential geometry, French, piano")} required maxLength={200} />
      </label>
      <div className="flex flex-wrap gap-1.5" aria-label={t("Examples")}>
        {examples.map((x) => (
          <button key={x} type="button" className="btn btn-sm" onClick={() => setTopic(x)}>
            {x}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="label">{t("Goal")}</span>
        <input className="input w-full" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("e.g. understand Riemannian geometry; speak French at B2")} maxLength={1000} />
      </label>
      <label className="block">
        <span className="label">{t("What you know already")}</span>
        <input className="input w-full" value={level} onChange={(e) => setLevel(e.target.value)} placeholder={t("e.g. calculus and linear algebra; school French")} maxLength={300} />
      </label>
      <p className="text-xs text-zinc-500">{t("Claude researches the topic (scholarly sources and curricula) and writes a plan over years, phases and small steps — it takes a few minutes.")}</p>
      <button type="submit" className="btn btn-primary" disabled={pending || !topic.trim()}>
        {pending ? t("Starting …") : t("Research and plan")}
      </button>
    </form>
  );
}
