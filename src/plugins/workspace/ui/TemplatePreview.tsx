"use client";

import type { JSONContent } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { createPageAction, duplicateTemplateAction } from "../actions";
import { kindIcon } from "../model";
import type { TemplatePreview as Preview } from "../templates";
import { Editor } from "./Editor";

/**
 * A built-in template, read only: a bar that says so — with "Duplicate as my template" (a page of yours to change, opened) and "Use"
 * (made where you choose, the top level first) — then its page as it would be made, what comes below it and the databases it makes.
 */
export function TemplatePreview({ preview: p, places }: { preview: Preview; places: { id: number; title: string; depth: number }[] }) {
  const t = useT();
  const router = useRouter();
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (r: Promise<{ ok: true; id: number } | { ok: false; error: string }>) => {
    setBusy(true);
    const done = await r;
    setBusy(false);
    if (!done.ok) return toast(done.error, { tone: "error" });
    router.push(`/workspace/${done.id}`);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" data-builtin-bar>
        <span className="flex-1">🔒 {t("Built-in template — read only")}</span>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void go(duplicateTemplateAction(p.key))}>
          ⧉ {t("Duplicate as my template")}
        </button>
        <select className="input w-auto py-1 text-sm" aria-label={t("Where")} value={where} onChange={(e) => setWhere(e.target.value)}>
          <option value="">{t("Top level")}</option>
          {places.map((x) => (
            <option key={x.id} value={x.id}>
              {"  ".repeat(x.depth)}
              {x.title}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void go(createPageAction({ templateKey: p.key, parentId: where ? Number(where) : null }))}>
          {t("Use")}
        </button>
      </div>

      <div className={`mx-auto w-full space-y-3 ${p.page.fullWidth || p.kind === "database" ? "max-w-none" : "max-w-3xl"}`}>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <span aria-hidden>{p.page.icon || p.icon}</span>
          {p.page.title || p.name}
        </h1>
        {p.description && <p className="text-sm text-zinc-500">{p.description}</p>}
        <Editor pageId={0} initial={p.page.content as JSONContent} rev={0} editable={false} smallText={false} dragHandles={false} />
        {p.databases.map((d, i) => (
          <section key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <h2 className="font-semibold">
              {d.icon || kindIcon("database")} {d.title}
            </h2>
            <p className="text-xs text-zinc-500">
              {t("Views")}: {d.views.join(" · ")} · {t("{n} example rows", { n: d.rows })}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {d.properties.map((x, k) => (
                <li key={k} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                  {x.name}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {p.children.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Below it")}</h2>
            <ul>
              {p.children.map((c, i) => (
                <li key={i} className="py-0.5 text-sm">
                  {c.icon || kindIcon(c.kind as never)} {c.title || t("Untitled")}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
