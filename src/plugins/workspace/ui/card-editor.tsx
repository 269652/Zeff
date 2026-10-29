"use client";

import { useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { cardScope, parseTemplate, renderTemplate, starterTemplate, MAX_TEMPLATE, type TplError } from "../card-template";
import type { DatabaseData } from "../actions";
import type { Property, Row, View } from "../model";
import { TemplateBody } from "./card-template";
import { Modal } from "./kit";

/**
 * "Card": write how the cards of a board or gallery look — a template with a live preview on the first rows of the view, the errors with
 * their line, and a reference of what can be written. Saved with the view; "automatic" goes back to the card Zeff makes by itself.
 */

/** What a template sees of a row on this page. */
export function scopeFor(row: Row, data: DatabaseData, props: Property[], key: string | null) {
  const labels = data.labels;
  return cardScope({
    row,
    props,
    titleName: data.schema.titleName,
    key,
    labels: { person: (id) => labels.people[id] ?? `#${id}`, page: (id) => labels.pages[id]?.title ?? `#${id}`, todo: (id) => labels.todos[id] ?? `T-${id}` },
  });
}

const examples = (t: (k: string) => string): { name: string; src: (props: Property[]) => string }[] => [
  { name: t("From my fields"), src: (p) => starterTemplate(p) },
  {
    name: t("Compact"),
    src: () => "<row><b>{{ title }}</b><grow/>{{ key | muted }}</row>\n{{ key | muted }}",
  },
  {
    name: t("Progress"),
    src: (p) => {
      const nums = p.filter((x) => x.type === "number" || x.type === "rollup");
      const ref = (x: Property) => (/^[A-Za-z_]\w*$/.test(x.name) ? x.name : `[${x.name}]`);
      const [a, b] = nums;
      return ["<b>{{ title }}</b>", a && b ? `<bar value={{ ${ref(a)} }} max={{ ${ref(b)} }} />\n<small>{{ ${ref(a)} | number(1) }} of {{ ${ref(b)} | number(1) }}</small>` : "<bar value=2 max=5 />"].join("\n");
    },
  },
  {
    name: t("Cover"),
    src: (p) => {
      const url = p.find((x) => x.type === "url");
      return [url ? `<img src="{{ ${/^[A-Za-z_]\w*$/.test(url.name) ? url.name : `[${url.name}]`} }}" h=120 />` : "", "<b>{{ title }}</b>", "{{ key | muted }}"].filter(Boolean).join("\n");
    },
  },
];

const HELP: [string, string][] = [
  ["{{ title }}  {{ key }}  {{ id }}  {{ icon }}", "the row's own values (also created, updated)"],
  ["{{ Status }}  {{ [Hours booked] }}", "a property by its name — in [brackets] when the name has spaces"],
  ["{{ Status | chip }}  {{ Due | date }}  {{ Due | relative }}", "filters change how a value shows: chip, date, relative, hours, number(1), percent, euro, upper, lower, truncate(30), clamp(3), default(\"–\"), join(\", \"), count, check, bold, muted, small, code, link, img(120), bar(8), initials"],
  ["{{#if Due < today()}} late {{#else}} ok {{/if}}", "conditions use the formulas' language: > < == != and or not, today(), … "],
  ["{{#each Labels}}<chip>{{ this }}</chip>{{/each}}", "a repeat over the values of a property"],
  ["<row gap=2> <col> <grow/> <hr/> <b> <i> <small> <muted> <code> <clamp lines=3> <chip color=blue> <badge> <bar value=3 max=5> <img src=… h=120> <a href=…>", "the tags there are (gap 0–8; row: align, justify, wrap)"],
];

export function CardEditor({ view, schema, rows, data, keys, onSave, onClose }: { view: View; schema: { properties: Property[]; titleName: string }; rows: Row[]; data: DatabaseData; keys: Record<number, string>; onSave: (card: string | undefined) => void; onClose: () => void }) {
  const t = useT();
  const [src, setSrc] = useState(view.card ?? "");
  const [help, setHelp] = useState(false);
  const parsed = useMemo(() => parseTemplate(src.slice(0, MAX_TEMPLATE)), [src]);
  const samples = rows.slice(0, 3);
  const rendered = useMemo(() => {
    if (!src.trim() || parsed.errors.length) return [];
    return samples.map((r) => renderTemplate(parsed.nodes, scopeFor(r, data, schema.properties, keys[r.id] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the samples follow the rows
  }, [parsed, src, rows.length]);
  const errors: TplError[] = [...parsed.errors, ...rendered.flatMap((r) => r.errors)].filter((e, i, a) => a.findIndex((x) => x.line === e.line && x.message === e.message) === i);

  return (
    <Modal title={t("Card — how the cards look")} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-zinc-500">{t("Write the card as a template. Without one, Zeff makes the card by itself from the row's values.")}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500">{t("Start from")}</span>
          {examples(t).map((e) => (
            <button key={e.name} type="button" className="btn btn-sm" onClick={() => setSrc(e.src(schema.properties))}>
              {e.name}
            </button>
          ))}
          <button type="button" className="ml-auto text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setHelp((v) => !v)}>
            {help ? t("Hide the reference") : t("Reference")}
          </button>
        </div>
        {help && (
          <div className="space-y-1.5 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700">
            {HELP.map(([code, what]) => (
              <div key={code}>
                <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{code}</code> <span className="text-zinc-500">— {what}</span>
              </div>
            ))}
            <div className="text-zinc-500">
              {t("Names you can use:")} {["title", "key", ...schema.properties.map((p) => p.name)].join(", ")}
            </div>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <textarea
            className="input min-h-56 w-full font-mono text-xs"
            value={src}
            spellCheck={false}
            placeholder={t("(automatic)")}
            aria-label={t("Card template")}
            onChange={(e) => setSrc(e.target.value)}
          />
          <div role="group" className="space-y-2" aria-label={t("Preview")}>
            {!src.trim() ? (
              <p className="text-sm text-zinc-500">{t("The automatic card — write a template or start from one of the examples.")}</p>
            ) : parsed.errors.length ? (
              <p className="text-sm text-zinc-500">{t("Fix the errors to see the preview.")}</p>
            ) : (
              rendered.map((r, i) => (
                <div key={samples[i].id} className="ws-card">
                  <TemplateBody nodes={r.nodes} />
                </div>
              ))
            )}
            {samples.length === 0 && <p className="text-sm text-zinc-500">{t("No rows to show it on yet.")}</p>}
          </div>
        </div>
        {errors.length > 0 && (
          <ul role="alert" className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
            {errors.map((e, i) => (
              <li key={i}>
                {t("Line {n}", { n: e.line })}: {e.message}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={() => (onSave(undefined), onClose())}>
            {t("Use the automatic card")}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={parsed.errors.length > 0} onClick={() => (onSave(src.trim() || undefined), onClose())}>
            {t("Save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
