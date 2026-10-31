import { getSqlite } from "@/db";
import { caseRefs } from "@/lib/todos/similar";
import { isInstalled } from "@/plugins/state";
import { caseKey, type CaseSource } from "./shared";
import { addSource, ensureCase, getCase, updateCase } from "./store";

/**
 * Finding the cases (the Cases plugin): the case numbers in mails, letters (documents) and todos, by rule —
 * no AI. A number becomes a case when it looks like one: written next to "Az.", "Zeichen", "Verfahren" …,
 * in a letter, or in more than one place; a calendar week or a page number never. Each place it stands
 * is a source of the case; the person whose address the mails and letters carry is the one on the other side.
 */

/** Words that say a number is a case number. */
const CASE_WORDS = /(?:^|[^\p{L}])(?:Az\.?|Aktenzeichen|Zeichen|Geschäftszeichen|Verfahren|Sache|Vorgang|Akte|Kassenzeichen)(?:$|[^\p{L}])/iu;
/** Numbers that are no case: a calendar week, a page, a paragraph, a number ("Nr 5/26"). */
const NOT_A_CASE = /^(?:KW|NR|NO|TEL|FAX|S|SEITE|ABS|ART|PAR|BL|BD|TZ|RZ|RN|CW)\b/;

type Hit = { key: string; label: string; source: CaseSource; worded: boolean; email?: string | null; text: string };

const all = <T>(sql: string): T[] => {
  try {
    return getSqlite().prepare(sql).all() as T[];
  } catch {
    return []; // the plugin behind it never ran
  }
};

/** Every place a case number stands, with what makes it one. */
function hits(): Hit[] {
  const out: Hit[] = [];
  const note = (text: string, source: CaseSource, email?: string | null) => {
    for (const label of caseRefs(text)) {
      const key = caseKey(label);
      if (!NOT_A_CASE.test(key)) out.push({ key, label, source, worded: CASE_WORDS.test(text) || source.kind === "doc", email, text });
    }
  };
  for (const m of all<{ key: string; subject: string; preview: string; at: string; email: string | null }>("select key, subject, preview, received_at at, lower(from_email) email from emails where (subject || ' ' || preview) like '%/%'")) {
    note(`${m.subject} — ${m.preview}`, { ref: `mail:${m.key}`, kind: "mail", at: m.at, title: m.subject }, m.email);
  }
  for (const d of all<{ id: number; name: string; summary: string; text: string; at: string }>("select id, name, summary, substr(text, 1, 6000) text, created_at at from documents where status = 'ready'")) {
    note(`${d.name}\n${d.summary}\n${d.text}`, { ref: `doc:${d.id}`, kind: "doc", at: d.at, title: d.name }, null);
  }
  if (isInstalled("todos")) {
    for (const t of all<{ id: number; text: string; note: string | null; at: string }>("select id, text, note, created_at at from todos where merged_into is null")) {
      note(`${t.text} ${t.note ?? ""}`, { ref: `todo:${t.id}`, kind: "todo", at: t.at, title: t.text }, null);
    }
  }
  return out;
}

/** The profile whose address the sources carry most (a mail from them, a letter with their address in it). */
function personOf(found: Hit[]): number | null {
  if (!isInstalled("people")) return null;
  const people = all<{ id: number; emails: string }>("select id, emails from people").map((p) => ({ id: p.id, emails: (JSON.parse(p.emails) as string[]).map((e) => e.toLowerCase()) }));
  const votes = new Map<number, number>();
  for (const h of found) {
    for (const p of people) {
      if (p.emails.some((e) => e === h.email || (h.source.kind === "doc" && h.text.toLowerCase().includes(e)))) votes.set(p.id, (votes.get(p.id) ?? 0) + 1);
    }
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The cases read again from the sources: new ones made, new places linked. */
export function detectCases(): { created: number; linked: number } {
  const byKey = new Map<string, Hit[]>();
  for (const h of hits()) byKey.set(h.key, [...(byKey.get(h.key) ?? []), h]);
  let created = 0;
  let linked = 0;
  for (const [key, found] of byKey) {
    const places = new Set(found.map((h) => h.source.ref));
    if (!found.some((h) => h.worded) && places.size < 2) continue;
    const newest = [...found].sort((a, b) => b.source.at.localeCompare(a.source.at))[0];
    const c = ensureCase(key, newest.label, newest.source.at);
    if (c.created) created++;
    const seen = new Set<string>();
    for (const h of found) {
      if (seen.has(h.source.ref)) continue;
      seen.add(h.source.ref);
      // (The places of a case made now are part of making it, not new links.)
      if (addSource(c.id, h.source, h === newest ? h.label : undefined) && !c.created) linked++;
    }
    if (getCase(c.id)?.personId == null) {
      const person = personOf(found);
      if (person) updateCase(c.id, { personId: person });
    }
  }
  return { created, linked };
}
