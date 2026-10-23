/**
 * The one door every write of Zeff to Gmail and Google Calendar goes through — and what it lets through, by method and path:
 * a mail sent, a draft made or sent, labels changed (archive, read/unread, spam, a label of your own), a label or a filter made;
 * an event inserted or patched (moved, edited, your answer to an invitation). Nothing else: no DELETE of any kind, nothing to the
 * trash (no /trash path, no TRASH label, no filter that trashes), no forwarding, no event cancelled (status "cancelled"), moved to
 * another calendar or a calendar cleared. The modules that write (gmail-write.ts, gmail-send.ts, calendar-write.ts) have no
 * request of their own — a test holds them to it. Server only.
 */
import { apiRequest, type ApiResponse } from "@/lib/connectors/http";
import { t } from "@/lib/i18n/server";

const GM = String.raw`^/gmail/v1/users/me`;
const CAL = String.raw`^/calendar/v3/calendars/[^/?]+/events`;

/** What may be written: the method and the path (without its query). */
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "POST", path: new RegExp(`${GM}/messages/send$`) },
  { method: "POST", path: new RegExp(`${GM}/drafts$`) },
  { method: "POST", path: new RegExp(`${GM}/drafts/send$`) },
  { method: "POST", path: new RegExp(`${GM}/messages/[0-9a-f]+/modify$`) },
  { method: "POST", path: new RegExp(`${GM}/threads/[0-9a-f]+/modify$`) },
  { method: "POST", path: new RegExp(`${GM}/messages/batchModify$`) },
  { method: "POST", path: new RegExp(`${GM}/labels$`) },
  { method: "POST", path: new RegExp(`${GM}/settings/filters$`) },
  { method: "POST", path: new RegExp(`${CAL}$`) },
  { method: "PATCH", path: new RegExp(`${CAL}/[^/?]+$`) },
];

/** Every label id a body would add (a modify, a batchModify, a filter's action). */
function addedLabels(body: unknown): string[] {
  const b = (body ?? {}) as { addLabelIds?: unknown; action?: { addLabelIds?: unknown } };
  return [b.addLabelIds, b.action?.addLabelIds].flatMap((x) => (Array.isArray(x) ? x.map(String) : []));
}

/** Throws unless the write is one of those allowed — and never one that deletes, trashes or cancels. */
export function checkGoogleWrite(method: string, pathOrUrl: string, body?: unknown): void {
  const m = String(method).toUpperCase();
  const p = String(pathOrUrl).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const refuse = (why: string): never => {
    throw new Error(t("Not allowed: {why} — Zeff never deletes, trashes or cancels anything in Google.", { why }));
  };
  if (m === "DELETE") refuse(`DELETE ${p}`);
  if (/\/(un)?trash(\/|$)|batchDelete|\/clear$|\/move$|forwarding/i.test(p)) refuse(p);
  if (!ALLOWED.some((a) => a.method === m && a.path.test(p))) refuse(`${m} ${p}`);
  if (addedLabels(body).some((l) => l.toUpperCase() === "TRASH")) refuse("TRASH");
  if (/^\/calendar\//.test(p) && String((body as { status?: unknown } | undefined)?.status ?? "").toLowerCase() === "cancelled") refuse("status cancelled");
}

/** A write to Google — checked first (see {@link checkGoogleWrite}). */
export async function googleWrite<T = unknown>(method: "POST" | "PATCH", path: string, body: unknown): Promise<ApiResponse<T>> {
  checkGoogleWrite(method, path, body);
  return apiRequest<T>("google", path, { method, body });
}
