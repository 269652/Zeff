/**
 * Noise: what is no person's word and no real money of yours — a newsletter, a system or bot sender, money only moved
 * between your own accounts or a bank's pocket, the same thing a second time from another source. One place for the
 * rules that were copied around (mail todos, people's identity and import, normalizing, entities, recurring payments);
 * each caller keeps its own reading of them (the named patterns below are the old ones, unchanged), `classifyNoise`
 * puts them together for a record of the pipelines. Recall first: a sender only "no-reply" is not noise by that
 * alone (a buyer's request, a bank's demand come that way) — newsletters, delivery failures and notifications are.
 * Pure: no database, safe on both sides.
 */

export type NoiseKind = "newsletter" | "bot" | "own-transfer" | "pocket" | "duplicate";
export type Noise = { kind: NoiseKind; why: string };
export type NoiseVerdict = { kind: NoiseKind | null; why: string };

// --- the patterns, as their callers had them ---

/** A mail sender that is a system, not a conversation partner (the mail todos' "current conversations"). */
export const SYSTEM_SENDER = /no-?reply|newsletter|notification|mailer-daemon|news@|marketing/i;
/** A name or address that is no person (people's identity resolution). */
export const NOT_A_PERSON = /no-?reply|newsletter|notification|mailer|support|service|team|bot\b|admin|jira|gitlab|microsoft|google|system|\d{3,}/i;
/** A name or address that is a system's (people's import). */
export const SYSTEMISH = /no-?reply|do-?not-?reply|notification|benachrichtigung|mailer|newsletter|noreply|bounce|^jira\b|gitlab|support@|info@|service@|^system/i;
/** A mail address that is no contact of yours (people's normalizing). */
export const NOT_A_CONTACT = /no-?reply|newsletter|notification|mailer|support|info@|service/i;
/** Domains that are a mail system's, not an organisation's ("teams.mail.microsoft", "send.example.com" read as its label). */
export const SYSTEM_LABELS = new Set(["mail", "email", "e", "send", "news", "newsletter", "info", "noreply", "no-reply", "notifications", "notification", "bounce", "mailer", "smtp", "mx", "m", "em", "t"]);
/** A bank's own pocket moves by their words ("… einzustecken", round-ups, savings). */
export const POCKET = /einzustecken|pocket|spartopf|ersparnis|round[- ]?up|aufrund|sparen|savings|vault/i;

// --- what classifyNoise reads ---

/** A newsletter or a mailing by its sender (the mail store keeps no List-Unsubscribe header: the address and the words). */
const NEWSLETTER_FROM = /newsletter|(^|[.@_-])news[.@]|marketing|mailing|promo(tion)?s?[.@]|angebote?@|deals?@/i;
/** An unsubscribe line in what the mail shows (what List-Unsubscribe would say). */
const UNSUBSCRIBE = /\b(unsubscribe|abmelden|abbestellen|newsletter abbestellen|vom newsletter)\b/i;
/** A machine that writes: delivery failures, notification and calendar robots, mail robots. */
const BOT_FROM = /mailer-daemon|postmaster|bounces?[.@+-]|notifications?[.@-]|-notification@|benachrichtigung|mailrobot|robot@/i;
/** A chat sender that is a machine (Teams' bots, a system's posts). */
const BOT_NAME = /\bbot\b|no-?reply|notification|benachrichtigung|^system\b/i;

/**
 * A record as noise is read from: a mail (`from`, `fromEmail`, `subject`, `text`, its `headers` when a store has them), a
 * message (`from` its sender), a booking (`counterparty`, `text`, `amount`, `key` the recipient's key) or an appointment.
 * `contentKey`: what makes it the same thing in another source (contentKeyOf).
 */
export type NoiseRecord = {
  type?: "mail" | "message" | "bank" | "calendar" | string;
  from?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  text?: string | null;
  headers?: Record<string, string | undefined>;
  counterparty?: string | null;
  amount?: number | null;
  key?: string | null;
  mine?: boolean;
  contentKey?: string | null;
};
/** What the reading knows beyond the record: content keys seen before (to their first ref), recipients that are your own accounts or only moved money. */
export type NoiseContext = { seen?: Map<string, string>; own?: Set<string> | Record<string, unknown>; ref?: string };

const owns = (own: NoiseContext["own"], key: string) => (own instanceof Set ? own.has(key) : !!own?.[key]);
const squash = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** What makes a record the same thing in another source: a mail's Message-ID (or sender, subject, minute and start); an appointment's title, start, organizer. */
export function contentKeyOf(r: { type?: string; headers?: Record<string, string | undefined>; fromEmail?: string | null; from?: string | null; subject?: string | null; text?: string | null; at?: string | null; start?: string | null; organizer?: string | null; title?: string | null }): string | null {
  if (r.type === "mail") {
    const id = r.headers?.["message-id"] ?? r.headers?.["Message-ID"];
    if (id) return `mid:${id.trim().toLowerCase()}`;
    if (!r.at) return null;
    return `mail:${squash(r.fromEmail ?? r.from)}|${squash(r.subject)}|${r.at.slice(0, 16)}|${squash(r.text).slice(0, 80)}`;
  }
  if (r.type === "calendar") {
    if (!r.start || !r.title) return null;
    return `cal:${squash(r.title)}|${r.start.slice(0, 16)}|${squash(r.organizer)}`;
  }
  return null;
}

/** Whether — and why — a record is noise. `ctx.seen` is filled as it goes (a duplicate is the second one of a content key). */
export function classifyNoise(r: NoiseRecord, ctx: NoiseContext = {}): NoiseVerdict {
  if (r.contentKey && ctx.seen) {
    const first = ctx.seen.get(r.contentKey);
    if (first !== undefined && first !== ctx.ref) return { kind: "duplicate", why: `the same as ${first}` };
    if (first === undefined) ctx.seen.set(r.contentKey, ctx.ref ?? "");
  }
  if (r.type === "bank") {
    const words = `${r.text ?? ""} ${r.counterparty ?? ""}`;
    if (POCKET.test(words)) return { kind: "pocket", why: "a pocket or savings move of the bank" };
    if (r.key && owns(ctx.own, r.key)) return { kind: "own-transfer", why: "money between your own accounts" };
    return { kind: null, why: "" };
  }
  if (r.mine) return { kind: null, why: "" };
  const email = String(r.fromEmail ?? "");
  const name = String(r.from ?? "");
  if (r.type === "mail" || email) {
    const unsub = r.headers?.["list-unsubscribe"] ?? r.headers?.["List-Unsubscribe"];
    if (unsub) return { kind: "newsletter", why: "it has an unsubscribe link (List-Unsubscribe)" };
    if (NEWSLETTER_FROM.test(email)) return { kind: "newsletter", why: `a newsletter sender (${email})` };
    if (BOT_FROM.test(email)) return { kind: "bot", why: `a system sender (${email})` };
    if (UNSUBSCRIBE.test(String(r.text ?? ""))) return { kind: "newsletter", why: "it says how to unsubscribe" };
    return { kind: null, why: "" };
  }
  if (name && BOT_NAME.test(name)) return { kind: "bot", why: `a system sender (${name})` };
  return { kind: null, why: "" };
}

/** A verdict as a record's field: the noise, or nothing. */
export const noiseOf = (v: NoiseVerdict): Noise | undefined => (v.kind ? { kind: v.kind, why: v.why } : undefined);
