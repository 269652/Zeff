"use client";

import { useRouter } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { rowViewAction, setCellAction, setRowTemplateAction, type DatabaseData } from "../actions";
import { withCell, type DbSchema, type Row, type View } from "../model";
import { rowViewMeta } from "../view-apps";
import type { TplError } from "../view-template";
import type { AppViewProps, ViewAppModule } from "./app-view";
import type { CellCtx } from "./cells";
import { ViewCode } from "./view-code";

/**
 * A row's own page (a person's, a case's — whatever its database's plugin brings): drawn from a view template — the database's own
 * (written by hand or by the AI, in the code panel here) or the plugin's — with the row as the one it is about.
 */

const MODULES: Record<string, () => Promise<ViewAppModule>> = {
  person: () => import("@/plugins/people/ui/row-parts").then((m) => m.default),
  case: () => import("@/plugins/cases/ui/row-parts").then((m) => m.default),
  // Any database's own detail page: no parts of a plugin, only the template.
  detail: () => import("./app-view").then((m) => ({ parts: {}, useAppData: m.useNoAppData })),
};

type HostProps = AppViewProps & { src: string; current: Row; onErrors?: (errors: TplError[]) => void };
const PAGES: Record<string, LazyExoticComponent<ComponentType<HostProps>>> = Object.fromEntries(
  Object.entries(MODULES).map(([id, load]) => [
    id,
    lazy(async () => {
      const [module, { TemplateView }] = await Promise.all([load(), import("./view-template")]);
      const meta = rowViewMeta(id)!;
      return { default: (p: HostProps) => <TemplateView {...p} module={module} meta={meta} /> };
    }),
  ]),
);

type Loaded = { view: string | null; dbId: number | null; title: string; schema: DbSchema | null; row: Row | null };

/** The custom view of a row — whatever its database's plugin brings; nothing where there is none (its plugin isn't installed). */
export function RowViewHost({ rowId, openCode = false }: { rowId: number; /** Opens with its code (the Studio). */ openCode?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [got, setGot] = useState<Loaded | null | undefined>(undefined);
  const [code, setCode] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [errors, setErrors] = useState<TplError[]>([]);
  const load = useCallback(() => {
    void rowViewAction(rowId).then((r) => setGot(r.ok ? r : null));
  }, [rowId]);
  useEffect(load, [load]);
  // The row's cells changed in place (a <field>, a set button): shown at once, as it will be stored; written, then read again
  // (what follows from it) — or, refused, put back as it was.
  const set = useCallback(
    (id: number, prop: string, value: unknown) => {
      setGot((g) => (g?.row && g.schema && g.row.id === id ? { ...g, row: withCell([g.row], g.schema.properties, id, prop, value)[0] } : g));
      void setCellAction(id, prop, value).then((r) => {
        if (!r.ok) toast(r.error, { tone: "error" });
        load();
      });
    },
    [load],
  );
  const ctx: CellCtx | undefined = useMemo(
    () =>
      got?.schema && got.row
        ? { data: { id: got.dbId, title: got.title, schema: got.schema, rows: [got.row], labels: { people: {}, pages: {}, todos: {} } } as unknown as DatabaseData, set, addOption: () => "", editable: true }
        : undefined,
    [got, set],
  );
  if (got === undefined) return <p className="text-sm text-zinc-400">…</p>;
  const Page = got?.view ? PAGES[got.view] : undefined;
  const meta = got?.view ? rowViewMeta(got.view) : undefined;
  if (!got || !Page || !meta || !got.row || !got.schema || !got.dbId || !ctx) return null;
  // (openCode: the page starts with its code open — until it is closed.)
  const draft = code ?? (openCode && !dismissed ? (got.schema.rowTemplate ?? meta.defaultTemplate(t)) : null);
  const view: View = { id: `row-${got.view}`, name: t("Detail page"), type: "app", app: got.view!, template: got.schema.rowTemplate, filter: { op: "and", rules: [] }, sorts: [], hidden: [] };
  const props: AppViewProps = { view, data: ctx.data, rows: [got.row], openRow: (id) => router.push(`/workspace/${id}`), reload: load, ctx };
  const save = async (template: string | null) => {
    const r = await setRowTemplateAction(got.dbId!, template);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setCode(null);
    toast(template ? t("The view is saved.") : t("The view is back to its default."), { tone: "ok" });
    load();
  };
  return (
    <div className="space-y-3">
      {/* The page as code: for every row of this database (its template), with the AI. */}
      <div className="flex justify-end print:hidden">
        <button type="button" className={`rounded px-1.5 py-0.5 font-mono text-xs ${draft !== null ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"}`} aria-pressed={draft !== null} title={t("This page as code (for all rows of “{db}”)", { db: got.title })} onClick={() => (draft === null ? setCode(got.schema!.rowTemplate ?? meta.defaultTemplate(t)) : (setCode(null), setDismissed(true)))}>
          &lt;/&gt; {t("Code")}
        </button>
      </div>
      {draft !== null && <ViewCode view={view} dbId={got.dbId} meta={meta} draft={draft} setDraft={setCode} errors={errors} onClose={() => (setCode(null), setDismissed(true))} onSave={(tpl) => void save(tpl)} rowId={got.row.id} fields={[got.schema.titleName, ...got.schema.properties.filter((p) => !p.id.startsWith("src")).map((p) => p.name)]} />}
      <Suspense fallback={<p className="text-sm text-zinc-400">…</p>}>
        <Page {...props} current={got.row} src={draft ?? got.schema.rowTemplate ?? meta.defaultTemplate(t)} onErrors={draft !== null ? setErrors : undefined} />
      </Suspense>
    </div>
  );
}
