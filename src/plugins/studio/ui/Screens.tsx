"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { DatabaseView } from "@/plugins/workspace/ui/DatabaseView";
import { RowViewHost } from "@/plugins/workspace/ui/row-view";
import { addDetailPageAction, addScreenAction, createAppAction, sampleRowAction } from "../server-actions";

/**
 * The screens of the Studio: a database's views — one drawn from a template opens with its code beside its live preview and the AI to
 * change it (the database's own editor, opened here); a new view; its rows' detail page, edited on one of its rows; a new app made in
 * one go (a web search, a catalogue, a tracker, an empty one).
 */

export type ScreenDb = { id: number; title: string; icon: string; parentId: number | null; dataType: string | null; views: { id: string; name: string; type: string; app: string | null; custom: boolean }[]; detail: "plugin" | "own" | null; firstRow: number | null; lifecycle: boolean };

export function ScreenEditor({ db, viewId, onView, onDetail, onChanged }: { db: ScreenDb; viewId: string | null; onView: (id: string) => void; onDetail: () => void; onChanged: () => void }) {
  const t = useT();
  const view = db.views.find((v) => v.id === viewId) ?? db.views.find((v) => v.custom) ?? db.views[0];
  const add = async () => {
    const name = window.prompt(t("Name of the new view"), t("New view"));
    if (!name) return;
    const r = await addScreenAction(db.id, name);
    if (!r.ok) return toast(r.error, { tone: "error" });
    onChanged();
    onView(r.viewId);
  };
  // The app, its buttons — one line with the code panel's own (a view drawn from a template), or above the view.
  const head = (
    <>
      <span className="text-xl" aria-hidden>
        {db.icon || "🗂️"}
      </span>
      <h2 className="text-lg font-semibold">{db.title || `#${db.id}`}</h2>
      {view && <span className="text-sm text-zinc-500">· {view.name}</span>}
      <button type="button" className="btn btn-sm" onClick={() => void add()}>
        + {t("View")}
      </button>
      <button type="button" className="btn btn-sm" onClick={onDetail}>
        {t("Detail page")}
      </button>
      <a className="btn btn-sm" href={`/workspace/${db.id}`}>
        {t("Its page")} ↗
      </a>
    </>
  );
  return (
    <div className="space-y-3">
      {!view?.custom && (
        <header className="flex flex-wrap items-center gap-2">
          {head}
          <span className="text-sm text-zinc-500">{t("A view of its own kind (a table, a board …): only a view drawn from a template is code.")}</span>
        </header>
      )}
      {view && <DatabaseView key={`${db.id}:${view.id}`} initial={null} dbId={db.id} viewId={view.id} onView={onView} embedded openCode bare codeHead={head} />}
    </div>
  );
}

export function DetailEditor({ db, onChanged }: { db: ScreenDb; onChanged: () => void }) {
  const t = useT();
  const [row, setRow] = useState<number | null>(db.firstRow);
  const [made, setMade] = useState(false);
  useEffect(() => {
    if (row || !db.detail) return;
    void sampleRowAction(db.id).then((r) => r.ok && setRow(r.rowId));
  }, [db.id, db.detail, row]);
  const create = async () => {
    const r = await addDetailPageAction(db.id);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setMade(true);
    onChanged();
  };
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xl" aria-hidden>
          {db.icon || "🗂️"}
        </span>
        <h2 className="text-lg font-semibold">
          {db.title}: {t("Detail page")}
        </h2>
        {row && (
          <a className="btn btn-sm ml-auto" href={`/workspace/${row}`}>
            {t("Open the row")} ↗
          </a>
        )}
      </header>
      {!db.detail && !made ? (
        <div className="card space-y-2 p-4">
          <p className="text-sm">{t("Its rows open as a page with their fields and text. A detail page of its own puts what matters on top — fields, the lifecycle's buttons, data a flow loads — and is code you can change like a view.")}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void create()}>
            {t("Make a detail page")}
          </button>
        </div>
      ) : row ? (
        <>
          <p className="text-sm text-zinc-500">{db.detail === "plugin" ? t("Its plugin brings this page; what you write here replaces it for every row of the database.") : t("Shown with one of its rows; it is the same for all of them.")}</p>
          <RowViewHost key={`${row}:${made}`} rowId={row} openCode />
        </>
      ) : (
        <p className="text-sm text-zinc-500">{t("Loading …")}</p>
      )}
    </div>
  );
}

const KINDS = (t: ReturnType<typeof useT>) =>
  [
    { id: "websearch", icon: "🔎", label: t("Web search"), what: t("Searches the web as you type and keeps the hits you want — a flow for the search, one for keeping, two panes.") },
    { id: "catalogue", icon: "🎬", label: t("Catalogue"), what: t("Films found at TMDB as you type, added with their poster, year and rating — a gallery with your own rating.") },
    { id: "tracker", icon: "📋", label: t("Tracker"), what: t("Items that move New → In progress → Done on a board, only along their lifecycle; details beside it.") },
    { id: "blank", icon: "✨", label: t("Empty"), what: t("A table and a screen of its own to build on — with the AI or by hand.") },
  ] as const;

export function NewApp({ onMade }: { onMade: (dbId: number) => void }) {
  const t = useT();
  const [kind, setKind] = useState<string>("websearch");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    const r = await createAppAction(kind, title);
    setBusy(false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(r.flows.length ? t("Made, with the flows {flows}.", { flows: r.flows.join(", ") }) : t("Made."), { tone: "ok" });
    onMade(r.dbId);
  };
  return (
    <div className="max-w-3xl space-y-4">
      <h2 className="text-lg font-semibold">{t("A new app")}</h2>
      <p className="text-sm text-zinc-500">{t("An app is a database with screens of its own (views drawn from a template), a detail page for its rows and the flows its buttons and searches run. Everything in it can be changed here afterwards.")}</p>
      <label className="block space-y-1">
        <span className="label mb-0">{t("Name")}</span>
        <input className="input" placeholder={t("My web search")} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {KINDS(t).map((k) => (
          <button key={k.id} type="button" className={`rounded-xl border p-3 text-left transition ${kind === k.id ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"}`} onClick={() => setKind(k.id)}>
            <div className="font-medium">
              {k.icon} {k.label}
            </div>
            <div className="text-xs text-zinc-500">{k.what}</div>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary" disabled={busy || !title.trim()} onClick={() => void make()}>
        {busy ? t("Working …") : t("Make it")}
      </button>
    </div>
  );
}
