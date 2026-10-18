/**
 * Changes to Gmail through Google's API — labels, read/unread, spam. Nothing is deleted or sent from here, and nothing is
 * changed unless Google was asked for it (the "gmail.modify" access, switched on on the Connections page). Server only.
 */
import { apiGet, apiRequest } from "@/lib/connectors/http";
import { getConnector } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { apiId, flat, getMeta, GM, header, parseFrom, refOf, search, unescapeHtml } from "./gmail-api";

export const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
/** The most mails one change touches (an agent's slip is then a small one). */
export const MAX_CHANGE = 200;

export const FILTERS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
/** The most mails a new filter is applied to at once (what is there already); the rest is for the filter, as mails come. */
export const MAX_APPLY = 1000;

/** Whether the Google sign-in holds the right to make Gmail filters. */
export const gmailCanFilter = (): boolean => getConnector("google").scope.split(/\s+/).includes(FILTERS_SCOPE);

/** Whether the Google sign-in holds the right to change Gmail. */
export const gmailCanWrite = (): boolean => getConnector("google").scope.split(/\s+/).includes(MODIFY_SCOPE);

type Label = { id: string; name: string; type?: string };

export async function gmailLabels(): Promise<Label[]> {
  return (await apiGet<{ labels?: Label[] }>("google", `${GM}/labels`)).labels ?? [];
}

/** The system labels an agent may name: what it can add or take off. TRASH is never one (no deleting from here). */
const SYSTEM: Record<string, string> = { inbox: "INBOX", spam: "SPAM", unread: "UNREAD", starred: "STARRED", important: "IMPORTANT" };
const FORBIDDEN = new Set(["trash", "papierkorb", "draft", "sent"]);

export type GmailChange = { refs: string[]; addLabels?: string[]; removeLabels?: string[]; markRead?: boolean; spam?: boolean };

/** The labels by name (an existing one is used, any case; a new one is made, with its parents in "a/b"). */
async function resolveLabels(names: string[], known: Label[], created: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s*\/\s*/g, "/");
    if (!name) continue;
    if (FORBIDDEN.has(name.toLowerCase())) throw new Error(t("Mails are not moved to the trash or deleted from here."));
    const sys = SYSTEM[name.toLowerCase()];
    if (sys) {
      ids.push(sys);
      continue;
    }
    const have = known.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (have) {
      ids.push(have.id);
      continue;
    }
    const r = await apiRequest<Label>("google", `${GM}/labels`, { method: "POST", body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
    if (r.status < 200 || r.status >= 300) throw new Error(t("Gmail would not make the label “{name}”.", { name }));
    known.push(r.body);
    created.push(name);
    ids.push(r.body.id);
  }
  return ids;
}

/** Labels added or taken off, read, spam — for up to {@link MAX_CHANGE} mails at once. */
export async function changeGmail(c: GmailChange): Promise<{ changed: number; createdLabels: string[] }> {
  if (!c.refs?.length) throw new Error(t("There are no mails to change."));
  if (!c.addLabels?.length && !c.removeLabels?.length && !c.markRead && !c.spam) throw new Error(t("There is nothing to change."));
  if (c.refs.length > MAX_CHANGE) throw new Error(t("At most {n} mails at once.", { n: MAX_CHANGE }));
  const ids = [...new Set(c.refs.map(apiId))];
  if (!gmailCanWrite()) throw new Error(t("Google was only asked for read access. Allow changes to Gmail on the Connections page and sign in to Google again."));
  const created: string[] = [];
  const known = await gmailLabels();
  const add = await resolveLabels(c.addLabels ?? [], known, created);
  const remove = await resolveLabels(c.removeLabels ?? [], known, created);
  if (c.markRead) remove.push("UNREAD");
  if (c.spam) {
    add.push("SPAM");
    remove.push("INBOX");
  }
  const addIds = [...new Set(add)];
  const removeIds = [...new Set(remove)].filter((x) => !addIds.includes(x));
  await batchModify(ids, addIds, removeIds);
  return { changed: ids.length, createdLabels: created };
}

async function batchModify(ids: string[], addLabelIds: string[], removeLabelIds: string[]): Promise<void> {
  const r = await apiRequest("google", `${GM}/messages/batchModify`, { method: "POST", body: { ids, addLabelIds, removeLabelIds } });
  if (r.status < 200 || r.status >= 300) throw new Error(t("Gmail refused the change ({status}).", { status: r.status }));
}

export type FilterCriteria = { from?: string; to?: string; subject?: string; /** Gmail's search words (has the words). */ query?: string; hasAttachment?: boolean };
export type NewFilter = { criteria: FilterCriteria; addLabels?: string[]; skipInbox?: boolean; markRead?: boolean; /** Also what matches now (up to {@link MAX_APPLY} mails). */ applyToExisting?: boolean };

/** The search that finds what a filter's criteria match. */
function criteriaQuery(c: FilterCriteria): string {
  const part = (key: string, v: string | undefined) => (v?.trim() ? `${key}:(${v.trim()})` : "");
  return [part("from", c.from), part("to", c.to), part("subject", c.subject), c.query?.trim() ?? "", c.hasAttachment ? "has:attachment" : ""].filter(Boolean).join(" ");
}

/**
 * A Gmail filter: what the mails are (sender, subject …), what happens to them — labels, out of the inbox, read. No forwarding and no
 * trash, ever. `applyToExisting`: the mails that match now get the same changes (Gmail's own "apply to existing" has no API).
 */
export async function createGmailFilter(f: NewFilter): Promise<{ filterId: string; createdLabels: string[]; applied: number }> {
  if (!gmailCanFilter()) throw new Error(t("Google was not asked for filters yet. Allow changes to Gmail on the Connections page and sign in to Google again."));
  const q = criteriaQuery(f.criteria ?? {});
  if (!q) throw new Error(t("Say what mails the filter is for (sender, subject or words)."));
  if (!f.addLabels?.length && !f.skipInbox && !f.markRead) throw new Error(t("The filter has nothing to do: a label, skipping the inbox or marking read."));
  const created: string[] = [];
  const addIds = [...new Set(await resolveLabels(f.addLabels ?? [], await gmailLabels(), created))];
  const removeIds = [...(f.skipInbox ? ["INBOX"] : []), ...(f.markRead ? ["UNREAD"] : [])];
  const c = f.criteria;
  const body = {
    criteria: { ...(c.from?.trim() ? { from: c.from.trim() } : {}), ...(c.to?.trim() ? { to: c.to.trim() } : {}), ...(c.subject?.trim() ? { subject: c.subject.trim() } : {}), ...(c.query?.trim() ? { query: c.query.trim() } : {}), ...(c.hasAttachment ? { hasAttachment: true } : {}) },
    action: { ...(addIds.length ? { addLabelIds: addIds } : {}), ...(removeIds.length ? { removeLabelIds: removeIds } : {}) },
  };
  const r = await apiRequest<{ id?: string }>("google", `${GM}/settings/filters`, { method: "POST", body });
  if (r.status < 200 || r.status >= 300 || !r.body?.id) throw new Error(t("Gmail refused the filter ({status}).", { status: r.status }));
  let applied = 0;
  if (f.applyToExisting) {
    const ids = (await search(q, Math.ceil(MAX_APPLY / 100))).slice(0, MAX_APPLY).map((x) => x.id);
    for (let i = 0; i < ids.length; i += MAX_CHANGE) await batchModify(ids.slice(i, i + MAX_CHANGE), addIds, removeIds);
    applied = ids.length;
  }
  return { filterId: r.body.id, createdLabels: created, applied };
}

export type GmailFilterRow = { id: string; from: string; to: string; subject: string; query: string; addLabelIds: string[]; removeLabelIds: string[] };

/** The filters Gmail has now. */
export async function listGmailFilters(): Promise<GmailFilterRow[]> {
  if (!gmailCanFilter()) throw new Error(t("Google was not asked for filters yet. Allow changes to Gmail on the Connections page and sign in to Google again."));
  const r = await apiGet<{ filter?: { id: string; criteria?: Record<string, string>; action?: { addLabelIds?: string[]; removeLabelIds?: string[] } }[] }>("google", `${GM}/settings/filters`);
  return (r.filter ?? []).map((x) => ({ id: x.id, from: x.criteria?.from ?? "", to: x.criteria?.to ?? "", subject: x.criteria?.subject ?? "", query: x.criteria?.query ?? "", addLabelIds: x.action?.addLabelIds ?? [], removeLabelIds: x.action?.removeLabelIds ?? [] }));
}

export type FoundMail = { ref: string; from: string; fromEmail: string | null; subject: string; snippet: string; unread: boolean; labels: string[]; date: string | null };

/** Gmail's own search (its query language: from:, in:, newer_than:, has:attachment …), the mails as an agent needs them. */
export async function findGmail(query: string, limit = 50): Promise<FoundMail[]> {
  const ids = (await search(String(query ?? "").slice(0, 500), Math.max(1, Math.ceil(Math.min(MAX_CHANGE, limit) / 100)))).slice(0, Math.min(MAX_CHANGE, limit));
  const out: FoundMail[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    const metas = await Promise.all(ids.slice(i, i + 4).map((x) => getMeta(x.id)));
    for (const m of metas) {
      const from = parseFrom(header(m, "from"));
      out.push({
        ref: refOf(m.id),
        from: from.name,
        fromEmail: from.email,
        subject: flat(header(m, "subject")),
        snippet: flat(unescapeHtml(m.snippet ?? "")),
        unread: !!m.labelIds?.includes("UNREAD"),
        labels: m.labelIds ?? [],
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      });
    }
  }
  return out;
}

