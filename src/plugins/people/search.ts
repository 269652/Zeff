import type { PaletteItem } from "@/lib/palette";
import { claimsOf } from "./graph";
import { detailsOf } from "./details";
import { listPeople, namesOf } from "./store";

/**
 * People found by what Zeff learned about them (the People plugin): the claims read from messages
 * (confirmed or proposed — not the rejected ones) and their details (IBAN, address, phone …), with
 * their names — "IBAN Nathanael", "Dienstkonto", "Luisenstraße". A name alone isn't a hit: this
 * searches what is known of them. For the context search (rag.ts) and the command palette. Server only.
 */

export type PersonHit = { personId: number; name: string; /** The claims and details that matched, as lines. */ text: string; /** How many of the words are in their names, claims and details. */ score: number };

/**
 * The people with any of the words in a claim or a detail — the most words first. `dated`: each detail with the
 * day it was last confirmed (for the AI: what holds, and since when — only details that hold are there).
 */
export function searchPeople(words: string[], opts: { dated?: boolean } = {}): PersonHit[] {
  const want = [...new Set(words.map((w) => w.toLowerCase()).filter(Boolean))];
  if (!want.length) return [];
  const has = (s: string) => want.filter((w) => s.toLowerCase().includes(w));
  const hits: PersonHit[] = [];
  for (const p of listPeople()) {
    const lines = [...claimsOf(p.id).map((c) => c.text), ...detailsOf(p.id).map((d) => (opts.dated ? `${d.value} (bestätigt ${d.confirmedAt.slice(0, 10)})` : d.value))];
    const matched = [...new Set(lines.filter((l) => has(l).length))].sort((a, b) => has(b).length - has(a).length);
    if (!matched.length) continue;
    const found = new Set([...has(namesOf(p).join(" ")), ...matched.flatMap(has)]);
    hits.push({ personId: p.id, name: p.name, text: matched.slice(0, 3).join(" · "), score: found.size });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** The command palette's people: those with every word of the query in their names, claims or details — linked to their page. */
export async function peoplePaletteItems(q: string, limit = 5): Promise<PaletteItem[]> {
  const words = [...new Set(q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2))].slice(0, 6);
  const hits = words.length ? searchPeople(words).filter((h) => h.score >= words.length) : [];
  if (!hits.length) return [];
  const { personHref } = await import("@/plugins/workspace/people-database");
  return hits.slice(0, limit).map((h) => ({ id: `person:${h.personId}`, label: h.name, hint: h.text.slice(0, 140), href: personHref(h.personId), group: "People" }));
}
