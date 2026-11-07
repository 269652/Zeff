"use server";

import { errorMessage } from "@/lib/errors";

/** Rows of a mail or inbox view archived — their whole conversations (archive.ts). */
export async function archiveRowsAction(rowIds: number[]): Promise<{ ok: true; archived: number; failed: string[] } | { ok: false; error: string }> {
  try {
    const { archiveMails, mailKeysOfRows } = await import("./archive");
    return { ok: true, ...(await archiveMails(mailKeysOfRows((Array.isArray(rowIds) ? rowIds : []).map(Number).filter((n) => n > 0).slice(0, 500)))) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Every read mail in the inboxes of the IMAP / POP3 accounts archived. */
export async function archiveReadAction(): Promise<{ ok: true; archived: number; failed: string[] } | { ok: false; error: string }> {
  try {
    return { ok: true, ...(await (await import("./archive")).archiveReadInbox()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The rows of a mail or inbox view opened: their IMAP / POP3 mails marked read (read-on-open.ts). How many. */
export async function markOpenedReadAction(rowIds: number[]): Promise<{ ok: true; marked: number } | { ok: false; error: string }> {
  try {
    const ids = (Array.isArray(rowIds) ? rowIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
    const { isInstalled } = await import("@/plugins/state");
    if (!ids.length || !isInstalled("imap-mail")) return { ok: true, marked: 0 };
    const { markOpenedRead } = await import("./read-on-open");
    return { ok: true, ...(await markOpenedRead(ids)) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
