"use client";

import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { rowActionAction } from "../actions";

type Kept = { ops: Record<string, unknown>[]; titles: string[]; why?: string };

const parse = (v: unknown): Kept | null => {
  if (typeof v !== "string" || !v) return null;
  try {
    const o = JSON.parse(v) as Kept;
    return Array.isArray(o.ops) && o.ops.length ? o : null;
  } catch {
    return null;
  }
};

/**
 * A row's suggested actions (the pipeline's "suggest actions" step): each a button — a draft opens for you (Outlook,
 * Gmail), a message is sent after you've read it, something is done in Zeff. Nothing kept: nothing shown.
 */
export function SuggestedActions({ rowId, value, onDone }: { rowId: number; value: unknown; onDone?: () => void }) {
  const t = useT();
  const kept = parse(value);
  if (!kept) return null;
  const run = async (op: Record<string, unknown>, title: string) => {
    const body = typeof op.body === "string" ? op.body : "";
    const draft = op.type === "mail-compose" || op.type === "gmail-compose" || op.type === "calendar-event";
    if (!draft && !confirmAction(`${title}\n\n${body}`.trim())) return;
    const r = await rowActionAction(rowId, op);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    if (r.href) window.open(r.href, "_blank");
    else toast(r.what ?? t("Done."), { tone: "ok" });
    onDone?.();
  };
  return (
    <div className="space-y-1 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2 text-sm dark:border-indigo-900 dark:bg-indigo-950/20" data-suggested>
      <p className="text-xs text-zinc-500">
        ⚡ {t("Suggested")}
        {kept.why ? ` — ${kept.why}` : ""}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {kept.ops.map((op, i) => (
          <button key={i} type="button" className="btn btn-sm" title={typeof op.body === "string" ? op.body : undefined} onClick={() => void run(op, kept.titles[i] ?? String(op.type))}>
            {kept.titles[i] ?? String(op.type)}
          </button>
        ))}
      </div>
    </div>
  );
}
