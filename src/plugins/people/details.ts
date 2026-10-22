/**
 * A person's details (the People plugin): their bank account (IBAN, BIC, bank), addresses, phone numbers
 * and office hours — properties of the profile, not sentences in a list. Read off what was said about them
 * (the claims the extraction made, see graph.ts) by rule, no AI: an IBAN only with its check digits right.
 * A detail from a claim lives as long as the claim does (rejected: gone); one you removed isn't read again;
 * one you add is yours. Server only.
 */
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { BIC_RE, IBAN_RE, ibanValid } from "@/lib/girocode";
import type { Payee } from "@/lib/girocode-todo";
import { isInstalled } from "@/plugins/state";
import { claimsOf } from "./graph";
import { listPeople, namesThem } from "./store";

export const DETAIL_KEYS = ["iban", "bic", "bank", "revtag", "address", "phone", "hours"] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];
export const isDetailKey = (k: string): k is DetailKey => (DETAIL_KEYS as readonly string[]).includes(k);

export type PersonDetail = { id: number; key: DetailKey; value: string; /** The claim it was read from (0: added by you). */ claimId: number; /** Yours, or its claim confirmed. */ confirmed: boolean };

// ---------------------------------------------------------------------------
// Reading them off a text
// ---------------------------------------------------------------------------

const STREET = String.raw`[\p{Lu}][\p{L}\-]*?(?:[Ss]tra(?:ß|ss)e|[Ss]tr\.|[Ww]eg|[Pp]latz|[Aa]llee|[Gg]asse|[Rr]ing|[Dd]amm|[Uu]fer|[Mm]arkt)`;
const CITY = String.raw`[\p{Lu}][\p{L}\-]*(?: (?:im|am|an der|in der|ob der) [\p{Lu}][\p{L}\-]*| [\p{Lu}][\p{L}\-]*)*`;
const ADDRESS = new RegExp(String.raw`(${STREET} \d+ ?[a-zA-Z]?),? (\d{5}) (${CITY})`, "gu");
/**
 * A RevTag: "RevTag @chris.b", "Revolut: @chris.b", the link revolut.me/chris.b — or without the @ when it is called a RevTag
 * ("RevTag: chris.b", "sein RevTag ist chris.b", "RevTag von Chris: chris.b"). Kept as "@chris.b".
 */
const REVTAG =
  /(?:\brevolut\.me\/([A-Za-z0-9][A-Za-z0-9._-]{2,30})|\b(?:Rev-?Tag|Revolut(?:-?(?:Tag|Name|Handle))?)\b[^@\n]{0,24}@([A-Za-z0-9][A-Za-z0-9._-]{2,30})|\bRev-?Tag\b(?:\s+von\s+[^:\n]{1,30}?)?(?:\s*:|\s+(?:ist|lautet))\s*([A-Za-z0-9][A-Za-z0-9._-]{2,30}))/gi;
const PHONE = /\b(?:Telefon|Tel\.|Tel|Mobil|Handy|Fon)\b:?\s*(\+?\d[\d /()-]{4,}\d)/gi;
const HOURS = /\b(?:Sprechstunden?|Sprechzeiten|Öffnungszeiten|Bürozeiten)\b:?\s*([^;]*?\d{1,2}(?:[:.]\d{2})?\s*(?:–|-|bis)\s*\d{1,2}(?:[:.]\d{2})?\s*Uhr)/gi;

/** The details a sentence carries, in the order they stand. */
export function detailsFromText(text: string): { key: DetailKey; value: string }[] {
  const out: { key: DetailKey; value: string; at: number }[] = [];
  const add = (key: DetailKey, value: string, at: number) => {
    const v = value.replace(/\s+/g, " ").trim().replace(/[.,;:]$/, "");
    if (v && !out.some((x) => x.key === key && x.value === v)) out.push({ key, value: v, at });
  };
  for (const m of text.matchAll(IBAN_RE)) if (ibanValid(m[0])) add("iban", m[0], m.index);
  const bic = BIC_RE.exec(text);
  if (bic) add("bic", bic[1], bic.index);
  // The bank: "Bank BBBank Karlsruhe", or the part of the account's sentence that names one.
  if (out.some((x) => x.key === "iban")) {
    const named = /\b(?:Bank|Kreditinstitut)\b:?\s+([^;,.]+)/.exec(text);
    const piece = named?.[1] ?? text.split(/[;,]/).find((s) => /bank|sparkasse|kasse\b/i.test(s) && !/IBAN|BIC|Konto\b/i.test(s));
    if (piece) add("bank", piece, text.indexOf(piece));
  }
  for (const m of text.matchAll(REVTAG)) add("revtag", `@${(m[1] ?? m[2] ?? m[3]).replace(/[.]+$/, "").toLowerCase()}`, m.index);
  for (const m of text.matchAll(ADDRESS)) add("address", `${m[1]}, ${m[2]} ${m[3]}`, m.index);
  for (const m of text.matchAll(PHONE)) if (m[1].replace(/\D/g, "").length >= 6) add("phone", m[1], m.index);
  for (const m of text.matchAll(HOURS)) add("hours", m[1], m.index);
  const order = (k: DetailKey) => DETAIL_KEYS.indexOf(k);
  return out.sort((a, b) => order(a.key) - order(b.key) || a.at - b.at).map(({ key, value }) => ({ key, value }));
}

// ---------------------------------------------------------------------------
// Kept with the profile
// ---------------------------------------------------------------------------

function db() {
  const d = getSqlite();
  d.exec(`create table if not exists people_details (id integer primary key autoincrement, person_id integer not null references people(id) on delete cascade, key text not null, value text not null, norm text not null, claim_id integer not null default 0, removed integer not null default 0, created_at text not null, unique (person_id, key, norm));`);
  return d;
}

/** For comparing: an IBAN or BIC without spaces, the rest in lower case with single spaces. */
const norm = (key: DetailKey, value: string) => (key === "iban" || key === "bic" ? value.replace(/\s+/g, "").toUpperCase() : value.replace(/\s+/g, " ").trim().toLowerCase());

type Row = { id: number; key: string; value: string; claim_id: number; removed: number };

/** Their details, in the order of DETAIL_KEYS, then as they came. */
export function detailsOf(personId: number): PersonDetail[] {
  const status = new Map(claimsOf(personId, { status: ["proposed", "confirmed"] }).map((c) => [c.id, c.status]));
  return (db().prepare("select id, key, value, claim_id, removed from people_details where person_id = ? and removed = 0 order by id").all(personId) as Row[])
    .filter((r): r is Row & { key: DetailKey } => isDetailKey(r.key))
    .map((r) => ({ id: r.id, key: r.key, value: r.value, claimId: r.claim_id, confirmed: !r.claim_id || status.get(r.claim_id) === "confirmed" }))
    .sort((a, b) => DETAIL_KEYS.indexOf(a.key) - DETAIL_KEYS.indexOf(b.key) || a.id - b.id);
}

/**
 * The details read again from their claims: new ones added, those of a claim that is gone or rejected
 * dropped. One you removed stays removed; yours stay. Whether anything changed.
 */
export function syncDetails(personId: number): boolean {
  const d = db();
  const claims = claimsOf(personId, { status: ["proposed", "confirmed"] });
  const live = new Set(claims.map((c) => c.id));
  let changed = d.prepare("delete from people_details where person_id = ? and claim_id != 0 and removed = 0 and claim_id not in (select value from json_each(?))").run(personId, JSON.stringify([...live])).changes > 0;
  const insert = d.prepare("insert or ignore into people_details (person_id, key, value, norm, claim_id, created_at) values (?, ?, ?, ?, ?, ?)");
  // The confirmed first: when two say the same, the detail goes with the checked one.
  for (const c of [...claims].sort((a, b) => Number(b.status === "confirmed") - Number(a.status === "confirmed") || a.id - b.id)) {
    for (const x of detailsFromText(c.text)) if (insert.run(personId, x.key, x.value, norm(x.key, x.value), c.id, new Date().toISOString()).changes) changed = true;
  }
  if (changed) emitChange("todos");
  return changed;
}

/** A detail you add (one you removed before comes back as yours). */
export function addDetail(personId: number, key: DetailKey, value: string): void {
  const v = value.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!v || !isDetailKey(key)) return;
  db()
    .prepare("insert into people_details (person_id, key, value, norm, claim_id, created_at) values (?, ?, ?, ?, 0, ?) on conflict (person_id, key, norm) do update set value = excluded.value, claim_id = 0, removed = 0")
    .run(personId, key, v, norm(key, v), new Date().toISOString());
  emitChange("todos");
}

/**
 * A transfer's account kept with its recipient: the one contact the name means (none or several: nobody), the IBAN (and BIC)
 * added as theirs unless they have it. The contact's name, or null.
 */
export function rememberAccount(name: string, iban: string, bic = ""): string | null {
  if (!isInstalled("people") || !ibanValid(iban)) return null;
  const who = listPeople().filter((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const matches = who.length ? who : listPeople().filter((p) => namesThem(p, name));
  if (matches.length !== 1) return null;
  const p = matches[0];
  const has = (key: DetailKey, v: string) => detailsOf(p.id).some((d) => d.key === key && norm(key, d.value) === norm(key, v));
  if (has("iban", iban)) return null;
  addDetail(p.id, "iban", iban);
  if (bic && !has("bic", bic)) addDetail(p.id, "bic", bic);
  return p.name;
}

/** A detail removed — kept as removed, so reading the claims again doesn't bring it back. */
export function removeDetail(personId: number, key: DetailKey, value: string): void {
  db().prepare("update people_details set removed = 1 where person_id = ? and key = ? and norm = ?").run(personId, key, norm(key, value));
  emitChange("todos");
}

/** The people with a bank account, as payees for a todo's GiroCode (see girocode-todo.ts): their details, what was said about them. */
export function payees(): Payee[] {
  return listPeople().flatMap((p) => {
    const details = detailsOf(p.id);
    if (!details.some((d) => d.key === "iban")) return [];
    const texts = claimsOf(p.id, { status: ["proposed", "confirmed"] }).map((c) => c.text);
    return [{ name: p.name, details, texts, names: (text: string) => namesThem(p, text) }];
  });
}
