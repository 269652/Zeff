"use client";

import { FormError } from "@/components/FormError";
import { useEffect, useRef, useState, useTransition } from "react";
import { askKnowledgeAction } from "@/plugins/knowledge/server-actions";
import { useT } from "@/components/I18nProvider";
import type { KnowledgeAnswer, KnowledgeTurn } from "./shared";
import type { QueryResultView } from "@/plugins/questions/shared";

type Msg = { role: "user"; text: string } | { role: "assistant"; text: string; answer: KnowledgeAnswer };

const KEY = "zeff-knowledge-chat";

/** An answer's [1], [2] … as links to its sources. */
function Cited({ text, answer }: { text: string; answer: KnowledgeAnswer }) {
  const byN = new Map(answer.sources.map((s) => [s.n, s]));
  return (
    <p className="whitespace-pre-wrap">
      {text.split(/(\[\d+\])/g).map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        const s = n ? byN.get(Number(n)) : undefined;
        if (!s) return <span key={i}>{part}</span>;
        return s.url ? (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" className="align-super text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400" title={s.title}>
            [{n}]
          </a>
        ) : (
          <span key={i} className="align-super text-xs font-semibold text-indigo-600 dark:text-indigo-400" title={s.title}>
            [{n}]
          </span>
        );
      })}
    </p>
  );
}

/** Under an answer from your data: the queries it was computed from — each in one line, its total and its first groups. */
function HowComputed({ queries }: { queries: QueryResultView[] }) {
  const t = useT();
  return (
    <details className="border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
      <summary className="cursor-pointer select-none">{t("How it was computed")}</summary>
      <ul className="mt-1 space-y-2">
        {queries.map((q, i) => (
          <li key={i} className="space-y-0.5">
            <code className="block break-words rounded bg-zinc-50 px-1.5 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">{q.explain}</code>
            <div>
              {t("Total")}: <span className="font-medium text-zinc-700 dark:text-zinc-200">{String(q.total.value ?? "—")}</span> · {t("{n} rows", { n: q.total.count })}
            </div>
            {q.groups.length > 0 && (
              <ul className="pl-3">
                {q.groups.slice(0, 8).map((g) => (
                  <li key={g.key}>
                    {g.key}: <span className="text-zinc-700 dark:text-zinc-200">{String(g.value ?? "—")}</span> ({g.count})
                  </li>
                ))}
                {q.groupsTotal > 8 && <li>{t("… and {n} more", { n: q.groupsTotal - 8 })}</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Asking the knowledge base: a conversation — each answer from the Confluence pages the search
 * found, citing them; the sources and the entities it touched below it. A question about numbers and dates in your own
 * data is answered from it instead (Structured questions), with how it was computed below. Kept in this browser.
 */
export function KnowledgeChat() {
  const t = useT();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the conversation as it was, after hydration
      if (raw) setMsgs(JSON.parse(raw) as Msg[]);
    } catch {
      // none kept
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(msgs.slice(-30)));
    } catch {
      // not kept
    }
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs]);

  const send = () => {
    const question = q.trim();
    if (!question || pending) return;
    const history: KnowledgeTurn[] = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    setError(null);
    start(async () => {
      const r = await askKnowledgeAction(question, history);
      if (r.ok) setMsgs((m) => [...m, { role: "assistant", text: r.answer.answer, answer: r.answer }]);
      else setError(r.error);
    });
  };

  return (
    <div className="card flex min-h-0 w-full flex-1 flex-col gap-3 p-4 max-lg:min-h-[70vh]">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {!msgs.length && <p className="text-sm text-zinc-500">{t("Ask something about the documentation — e.g. “How does code get onto the test environment?” or “Who runs the ordering system?”")}</p>}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="max-w-3xl self-end rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-4xl space-y-2 self-start rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <Cited text={m.text} answer={m.answer} />
              {m.answer.sources.length > 0 && (
                <ol className="space-y-0.5 border-t border-zinc-100 pt-2 text-xs dark:border-zinc-800">
                  {m.answer.sources.map((s) => (
                    <li key={s.n} className="truncate">
                      <span className="text-zinc-400">[{s.n}]</span>{" "}
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}
                      {s.heading && <span className="text-zinc-500"> › {s.heading}</span>}
                    </li>
                  ))}
                </ol>
              )}
              {m.answer.structured && m.answer.structured.queries.length > 0 && <HowComputed queries={m.answer.structured.queries} />}
              {m.answer.entities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.answer.entities.map((e) => (
                    <span key={e.id} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={[e.summary, ...e.related.map((r) => (r.dir === "out" ? `→ ${r.rel} ${r.name}` : `← ${r.name} ${r.rel}`))].join("\n")}>
                      {e.name} <span className="text-zinc-400">{e.type}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {pending && <p className="text-sm text-zinc-500">{t("Searching and answering …")}</p>}
        {error && <FormError as="p">{error}</FormError>}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Ask a question …")} aria-label={t("Question")} />
        <button type="submit" className="btn btn-primary" disabled={pending || !q.trim()}>
          {t("Ask")}
        </button>
        {msgs.length > 0 && (
          <button type="button" className="btn" disabled={pending} onClick={() => setMsgs([])} title={t("New conversation")}>
            {t("New")}
          </button>
        )}
      </form>
    </div>
  );
}
