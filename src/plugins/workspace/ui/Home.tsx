"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { formatAgo } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import { askWorkspaceAction, createPageAction, importCsvAction, importMarkdownAction } from "../actions";
import type { PageRef } from "../store";
import type { TemplateMeta } from "../templates";
import { TemplateGallery } from "./TemplateGallery";

/** The Workspace's start page: recent pages, a question to your pages, templates, imports. */
export function Home({ recent, templates, llm }: { recent: PageRef[]; templates: TemplateMeta[]; llm: boolean }) {
  const t = useT();
  const router = useRouter();
  const [answer, setAnswer] = useState<{ answer: string; pages: { id: number; title: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState<string | null>(null);
  const mdInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  const go = async (v: Parameters<typeof createPageAction>[0]) => {
    const r = await createPageAction(v);
    if (!r.ok) return toast(r.error, { tone: "error" });
    router.push(`/workspace/${r.id}`);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t("Workspace")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("Pages and databases — and your people, todos and tickets one @ away.")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void go({})}>
            📄 {t("New page")}
          </button>
          <button type="button" className="btn" onClick={() => void go({ kind: "database", title: t("Database") })}>
            🗂️ {t("New database")}
          </button>
          <button type="button" className="btn" onClick={() => mdInput.current?.click()}>
            ⇧ {t("Import Markdown")}
          </button>
          <button type="button" className="btn" onClick={() => csvInput.current?.click()}>
            ⇧ {t("Import CSV as a database")}
          </button>
          <input
            ref={mdInput}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const r = await importMarkdownAction(await f.text(), f.name.replace(/\.[^.]+$/, ""), null);
              if (r.ok) router.push(`/workspace/${r.id}`);
              else toast(r.error, { tone: "error" });
              router.refresh();
            }}
          />
          <input
            ref={csvInput}
            type="file"
            accept=".csv,.tsv,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const r = await importCsvAction(await f.text(), f.name.replace(/\.[^.]+$/, ""), null);
              if (r.ok) {
                toast(t("{n} rows imported.", { n: r.rows }), { tone: "ok" });
                router.push(`/workspace/${r.id}`);
              } else toast(r.error, { tone: "error" });
              router.refresh();
            }}
          />
        </div>
      </div>

      {llm && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-violet-700 uppercase dark:text-violet-300">✨ {t("Ask your workspace")}</h2>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
              if (!q) return;
              setBusy(true);
              setAnswer(null);
              const r = await askWorkspaceAction(q);
              setBusy(false);
              if (r.ok) setAnswer({ answer: r.answer, pages: r.pages });
              else toast(r.error, { tone: "error" });
            }}
          >
            <input name="q" className="input flex-1" placeholder={t("What did we decide about …?")} aria-label={t("Your question")} />
            <button className="btn btn-primary" disabled={busy}>
              {busy ? t("Reading …") : t("Ask")}
            </button>
          </form>
          {answer && (
            <div className="space-y-2 text-sm">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              {answer.pages.length > 0 && (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  {t("From:")}
                  {answer.pages.map((p) => (
                    <Link key={p.id} href={`/workspace/${p.id}`} className="ws-chip" data-kind="page">
                      📄 {p.title}
                    </Link>
                  ))}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t("Recent")}</h2>
        {recent.length ? (
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(13.5rem,1fr))]">
            {recent.map((p) => (
              <li key={p.id}>
                <Link href={`/workspace/${p.id}`} className="flex items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 text-sm shadow-sm transition hover:-translate-y-px hover:border-indigo-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-base dark:bg-zinc-800" aria-hidden>
                    {p.icon || (p.kind === "database" ? "🗂️" : "📄")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.title || t("Untitled")}</span>
                    <span className="block text-xs text-zinc-500">{formatAgo(p.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">{t("Nothing opened yet — start with a page or a template below.")}</p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t("Start from a template")}</h2>
          <p className="text-sm text-zinc-500">{t("Dashboards, task boards, meeting notes, agents — ready to use, yours to change.")}</p>
        </div>
        <TemplateGallery
          templates={templates}
          busy={making}
          onPick={(key) => {
            setMaking(key);
            void go({ templateKey: key }).finally(() => setMaking(null));
          }}
        />
      </section>
    </div>
  );
}
