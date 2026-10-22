import { t } from "@/lib/i18n/server";
import { entityDetail, type EntityDetail } from "./detail";
import { foldName, registrableDomain } from "./normalize";
import { resolveEntity } from "./resolve";
import { ENTITY_KINDS, getEntity, listEntities, type EntityKind } from "./store";
import type { EntitySuggestion } from "./suggest";

/**
 * The Entities plugin's tools: finding organisations, places and projects by a word (MCP entity_search), one with everything
 * linked to it (entity_get), and a proposal in words (the review queue). Server only.
 */

export type EntityHit = { ref: string; kind: EntityKind; name: string; aliases: string[]; domains: string[]; address: string };

/**
 * Organisations, places and projects a query names: exact resolutions first (an address, a domain, a ticket key, a name as
 * normalized), then names, other names, domains and addresses that start with or contain it. `kind`: only these.
 */
export function entitySearch(query: string, opts: { kind?: EntityKind; limit?: number } = {}): EntityHit[] {
  const q = foldName(query);
  if (!q) return [];
  const kinds = opts.kind ? [opts.kind] : [...ENTITY_KINDS];
  const scored = new Map<string, { hit: EntityHit; score: number }>();
  const put = (hit: EntityHit, score: number) => {
    const had = scored.get(hit.ref);
    if (!had || had.score < score) scored.set(hit.ref, { hit, score });
  };
  const asHit = (e: { ref: string; kind: EntityKind; name: string; aliases: string[]; domains: string[]; address: string }): EntityHit => ({ ref: e.ref, kind: e.kind, name: e.name, aliases: e.aliases, domains: e.domains, address: e.address });
  for (const m of resolveEntity(query)) {
    if (m.kind === "person" || !kinds.includes(m.kind)) continue;
    const e = getEntity(m.ref);
    if (e) put(asHit(e), 10);
  }
  const domain = /\./.test(query) ? registrableDomain(query) : "";
  for (const kind of kinds) {
    for (const e of listEntities(kind)) {
      const forms = [e.name, ...e.aliases, e.address].filter(Boolean).map(foldName);
      let score = 0;
      if (forms.includes(q)) score = 8;
      else if (forms.some((f) => f.startsWith(q))) score = 5;
      else if (forms.some((f) => f.includes(q))) score = 3;
      if (e.domains.some((d) => d === domain || d.includes(q))) score = Math.max(score, domain && e.domains.includes(domain) ? 9 : 3);
      if (score) put(asHit(e), score);
    }
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.hit.name.localeCompare(b.hit.name))
    .slice(0, opts.limit ?? 20)
    .map((x) => x.hit);
}

/** One entity with its links, its people and what it gathers (null: no such one). */
export const entityGet = (ref: string): EntityDetail | null => entityDetail(ref);

const KIND_WORD = () => ({ org: t("organisation"), place: t("place"), project: t("project") }) as Record<string, string>;

/** What a proposal says, in words (`nameOf`: an entity's name by its ref). */
export function entitySuggestionText(s: EntitySuggestion, nameOf: (ref: string) => string | undefined = (ref) => getEntity(ref)?.name): string {
  const target = nameOf(s.ref) ?? s.ref;
  switch (s.kind) {
    case "org":
      return s.data.domains?.length ? t("New organisation: {name} ({domains})", { name: s.name, domains: s.data.domains.join(", ") }) : t("New organisation: {name}", { name: s.name });
    case "place":
      return t("New place: {name}", { name: s.name });
    case "project":
      return t("New project: {name} ({links})", { name: s.name, links: (s.data.links ?? []).map((l) => `${l.rel} ${l.label ?? l.target}`).join(", ") });
    case "alias":
      return t("“{alias}” is another name of {name}", { alias: s.name, name: target });
    case "merge":
      return t("Merge {other} into {name}", { other: nameOf(s.otherRef) ?? s.name, name: target });
    case "link":
      return t("Link to {name}: {links}", { name: target, links: (s.data.links ?? []).map((l) => `${l.rel} ${l.label ?? l.target}`).join(", ") });
  }
}

/** An entity in one line, for lists: "Acme (organisation) — example.com". */
export function entityLine(e: EntityHit): string {
  const where = e.kind === "project" ? (e.address ? t("Job {number}", { number: e.address }) : "") : e.address !== e.name ? e.address : "";
  const parts = [e.domains.join(", "), where].filter(Boolean);
  return `${e.name} (${KIND_WORD()[e.kind]}, ${e.ref})${parts.length ? ` — ${parts.join(" — ")}` : ""}${e.aliases.length ? ` · ${t("also: {aliases}", { aliases: e.aliases.join(", ") })}` : ""}`;
}
