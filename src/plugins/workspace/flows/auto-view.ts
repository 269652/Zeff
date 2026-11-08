import type { DbSchema } from "../model";

/**
 * A database's view as it comes when a flow makes one (db.ensure): its title; for its first number field the figures — the mean of the
 * last ten, of all, the last one, with its course — and its rows newest first (by its first date), each with its other fields. A start
 * to change in the Studio. Client-safe.
 */

const q = (s: string) => s.replace(/"/g, "'");

export function autoTemplate(s: Pick<DbSchema, "properties">, labels: { last10: string; all: string; last: string; answers: string; empty: string }): string {
  const date = s.properties.find((p) => p.type === "date");
  const num = s.properties.find((p) => p.type === "number");
  const rest = s.properties.filter((p) => p !== date && p !== num && ["text", "select", "multi_select", "checkbox", "url", "status"].includes(p.type)).slice(0, 3);
  const sorted = date ? `rows | sort('${q(date.name)}', 'desc')` : "rows";
  const N = num ? q(num.name) : "";
  return [
    `<header title="{{ db.title }}" subtitle="{{ rows | count }} ${q(labels.answers)}"/>`,
    num
      ? `<grid cols=3 min=160><tile label="${q(labels.last10)}" value="{{ ${sorted} | limit(10) | avg('${N}') | number(1) | default('—') }}" icon="📈"${date ? ` spark="{{ rows | sort('${q(date.name)}') | pluck('${N}') | join(',') }}"` : ""}/><tile label="${q(labels.all)}" value="{{ rows | avg('${N}') | number(1) | default('—') }}"/><tile label="${q(labels.last)}" value="{{ ${sorted} | pluck('${N}') | first | default('—') }}"/></grid>`
      : "",
    `<list source="${sorted}" page=30 open=true empty="${q(labels.empty)}"><row wrap=false gap=2><col fill=true><b>{{ title | default('—') }}</b>${rest.map((p) => (p.type === "text" || p.type === "url" ? `{{#if [${p.name}]}}<small><muted>{{ [${p.name}] }}</muted></small>{{/if}}` : `{{ [${p.name}] | chip }}`)).join("")}</col>${date ? `<small><muted>{{ [${date.name}] | date }} {{ [${date.name}] | relative }}</muted></small>` : ""}</row></list>`,
  ]
    .filter(Boolean)
    .join("\n");
}
