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
  const r = await apiRequest("google", `${GM}/messages/batchModify`, { method: "POST", body: { ids, addLabelIds: addIds, removeLabelIds: removeIds } });
  if (r.status < 200 || r.status >= 300) throw new Error(t("Gmail refused the change ({status}).", { status: r.status }));
  return { changed: ids.length, createdLabels: created };
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

