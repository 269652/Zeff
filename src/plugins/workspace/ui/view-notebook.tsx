"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useT } from "@/components/I18nProvider";
import { Markdown } from "@/components/Markdown";
import { compileDossierAction, dossierAction } from "../actions";
import type { DatabaseAnswer, Dossier, DossierJob } from "../dossier";
import { postJson } from "./post-json";

const POLL_MS = 1500;
/** Where a source named in an answer points: never followed (Markdown takes only real addresses, this one is reserved to lead nowhere). */
const SOURCE = "https://source.invalid/";

/** An answer as the AI wrote it (Markdown), with its [1] leading to the row it comes from. */
function Answer({ answer, openRow }: { answer: DatabaseAnswer; openRow: (id: number) => void }) {
  const known = new Set(answer.sources.map((s) => s.n));
  const text = answer.answer.replace(/\[(\d+)\]/g, (m, n: string) => (known.has(Number(n)) ? `[${n}](${SOURCE}${n})` : m));
  const follow = (e: MouseEvent) => {
    const n = (e.target as HTMLElement).closest("a")?.getAttribute("href")?.split(SOURCE)[1];
    if (!n) return;
    e.preventDefault();
    const s = answer.sources.find((x) => x.n === Number(n));
    if (s) openRow(s.id);
  };
  return (
    <div className="ws-answer space-y-2" onClickCapture={follow}>
      <Markdown text={text} />
      {answer.sources.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {answer.sources.map((s) => (
            <li key={s.n}>
              <button type="button" className="max-w-56 truncate rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" onClick={() => openRow(s.id)}>
                {s.n} · {s.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A view's <ask>: a conversation with the rows — the questions and their answers, the field at the bottom, a few questions to start from. */
export function AskBox({ a, dbId, openRow }: { a: Record<string, string>; dbId: number; openRow: (id: number) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [talk, setTalk] = useState<{ question: string; answer: DatabaseAnswer }[]>([]);
  const last = useRef<HTMLDivElement>(null);
  const send = async (question: string) => {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError("");
    setQ("");
    const r = await postJson<DatabaseAnswer>("/api/workspace/ask", { dbId, question }, t("Zeff didn't answer."));
    setBusy(false);
    if (!r.ok) {
      setQ(question);
      return setError(r.error);
    }
    setTalk((list) => [...list, { question, answer: { answer: r.answer, sources: r.sources } }]);
    requestAnimationFrame(() => last.current?.scrollIntoView({ block: "start" }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(q);
  };
  const label = a.placeholder ?? t("Ask these sources …");
  const ideas = (a.suggest ?? "").split("|").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="flex min-h-0 flex-1 flex-col print:hidden" onClick={(e) => e.stopPropagation()}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm" aria-live="polite">
        {!talk.length && !busy && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            {a.intro && <p className="max-w-prose text-zinc-500">{a.intro}</p>}
            {ideas.length > 0 && (
              <div className="flex max-w-prose flex-wrap justify-center gap-1.5">
                {ideas.map((idea) => (
                  <button key={idea} type="button" className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" onClick={() => void send(idea)}>
                    {idea}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {talk.map((x, i) => (
          <div key={i} ref={i === talk.length - 1 ? last : undefined} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-1.5 text-white">{x.question}</p>
            <Answer answer={x.answer} openRow={openRow} />
          </div>
        ))}
        {busy && <p className="text-zinc-500">{t("Reading …")}</p>}
      </div>
      {error && <p role="alert" className="alert-error mx-3">{error}</p>}
      <form className="flex shrink-0 gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800" onSubmit={submit}>
        <input className="input min-w-0 flex-1 text-sm" aria-label={label} placeholder={label} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={busy || q.trim().length < 3}>
          {t("Ask")}
        </button>
      </form>
    </div>
  );
}

/** A view's <dossier>: what the rows say together, compiled — brought up to date by its button, only what changed. */
export function DossierBox({ a, dbId, rowsKey }: { a: Record<string, string>; dbId: number; /** Changes when the rows do. */ rowsKey: string }) {
  const t = useT();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [job, setJob] = useState<DossierJob | null>(null);
  const [error, setError] = useState("");
  // Read when shown, when the rows change and after a start; while a run goes on, again and again.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const r = await dossierAction(dbId);
      if (gone) return;
      if (!r.ok) return setError(r.error);
      setDossier(r.dossier);
      setJob(r.job);
      setError(r.job?.error ?? "");
      if (r.job?.running) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [dbId, rowsKey, asked]);

  const compile = async () => {
    setError("");
    const r = await compileDossierAction(dbId, a.focus);
    if (!r.ok) return setError(r.error);
    setAsked((n) => n + 1);
  };

  const running = !!job?.running;
  const shown = dossier?.markdown ?? "";
  return (
    <section className={`space-y-2 ${a.plain === "true" ? "" : "rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <span className="text-xs text-zinc-500">
          {running ? t("Reading {done} of {of} …", { done: job?.done ?? 0, of: job?.of ?? 0 }) : dossier?.pending ? t("{n} sources not read yet", { n: dossier.pending }) : dossier?.stale ? t("Sources changed") : shown ? t("Up to date") : ""}
        </span>
        {(running || !shown || dossier?.stale) && (
          <button type="button" className={`btn btn-sm ${shown ? "" : "btn-primary"}`} disabled={running || !dossier?.rows} onClick={() => void compile()}>
            {running ? t("Compiling …") : shown ? t("Update") : t("Compile")}
          </button>
        )}
      </div>
      {error && <p role="alert" className="alert-error">{error}</p>}
      {shown ? <Markdown text={shown} /> : <p className="text-sm text-zinc-500">{a.empty ?? t("Nothing compiled yet.")}</p>}
    </section>
  );
}
