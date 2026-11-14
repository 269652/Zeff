"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import type { DatabaseData } from "../actions";
import type { View } from "../model";
import { viewAppMeta } from "../view-apps";
import type { TplError } from "../view-template";
import type { BlockDef } from "../blocks";
import { useNoAppData } from "./app-view";
import { useBlockDefs } from "./use-blocks";
import { TemplateView } from "./view-template";

/**
 * A block of your own (the view language: its template, its parameters, its own state and flows) right in a page — no database around
 * it. Drawn by the same engine as a view: what a block does in a view it does here, on no rows (`rows` is empty; it reads what it shows
 * through its flows, `<data flow=…>`). The page is the one it stands on.
 */

const MODULE = { parts: {}, useAppData: useNoAppData };
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function PageBlock({ block, params, pageId, title, draft, onErrors }: { block: string; params: Record<string, string>; pageId: number; title?: string; /** The block as being edited (the Studio's preview), drawn instead of as saved. */ draft?: BlockDef; /** Its template's mistakes, told (the code panel shows them) — the block then shows none of its own. */ onErrors?: (errors: TplError[]) => void }) {
  const t = useT();
  const router = useRouter();
  const defs = useBlockDefs();
  const [errors, setErrors] = useState<TplError[]>([]);
  const meta = viewAppMeta("template");
  const src = useMemo(() => `<use block="${attr(block)}"${Object.entries(params).map(([k, v]) => ` ${k}="${attr(v)}"`).join("")}/>`, [block, params]);
  // (A page has no database: an empty one stands in, named as the page — the view's settings and the AI's context are the page's.)
  const data = useMemo(
    () =>
      ({
        id: pageId,
        title: title ?? "",
        icon: "",
        schema: { titleName: "Name", properties: [], views: [] },
        rows: [],
        labels: { people: {}, pages: {}, todos: {} },
        templates: [],
        related: {},
        locked: true,
        extras: { keys: {}, subtasks: {}, tickets: {}, todosOn: false, briefing: false, knowledge: false, me: { names: [], ids: [] }, source: null, previews: {} },
      }) as unknown as DatabaseData,
    [pageId, title],
  );
  const view: View = useMemo(() => ({ id: `block-${block}`, name: block, type: "app", app: "template", template: src, filter: { op: "and", rules: [] }, sorts: [], hidden: [] }), [block, src]);
  const drafts = useMemo(() => (draft ? [draft] : undefined), [draft]);
  if (defs === null) return <p className="text-sm text-zinc-400">…</p>;
  if (!draft && !defs.some((d) => d.name === block)) return <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">{t("There is no block “{name}” (Studio → Blocks lists them).", { name: block })}</p>;
  if (!meta) return null;
  return (
    <div className="ws-page-block space-y-2">
      {!onErrors && errors.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <summary className="cursor-pointer">{t("This block has {n} mistakes in its template.", { n: errors.length })}</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {errors.slice(0, 20).map((e, i) => (
              <li key={i}>
                {t("line {n}", { n: e.line })}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <TemplateView src={src} onErrors={onErrors ?? setErrors} module={MODULE} meta={meta} view={view} data={data} rows={[]} draftBlocks={drafts} openRow={(id) => router.push(`/workspace/${id}`)} reload={() => router.refresh()} />
    </div>
  );
}
