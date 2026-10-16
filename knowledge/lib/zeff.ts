import type { RawPage } from "./confluence";
import { ACCOUNT, getSettings } from "./db";

/** Zeff (its Knowledge plugin's export): where it is, and its token (the same KNOWLEDGE_TOKEN, when set). */
export const zeffUrl = () => (process.env.ZEFF_URL || "http://127.0.0.1:9333").replace(/\/+$/, "");

/**
 * What Zeff has synced, as pages — Jira, Teams, mails, GitLab, todos, time entries, recaps — of
 * this knowledge server's account (never just the one Zeff is in: that would swap one account's
 * pages for another's on the next read). `only: "keep"`: just the Google Keep notes.
 */
export async function zeffPages(only?: "keep"): Promise<{ account: string; pages: RawPage[] }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.KNOWLEDGE_TOKEN) headers.authorization = `Bearer ${process.env.KNOWLEDGE_TOKEN}`;
  let r: Response;
  try {
    // What was picked from Zeff's catalog (none: everything as Zeff exports it by default).
    const pick = only ? "" : getSettings().zeffInclude.trim();
    r = await fetch(`${zeffUrl()}/api/knowledge/export?account=${encodeURIComponent(ACCOUNT)}${only ? `&only=${only}` : ""}${pick ? `&include=${encodeURIComponent(pick)}` : ""}`, { headers, signal: AbortSignal.timeout(120000), cache: "no-store" });
  } catch {
    throw new Error(`Zeff doesn't answer (${zeffUrl()}).`);
  }
  const data = (await r.json().catch(() => null)) as { account?: string; docs?: RawPage[]; error?: string } | null;
  if (!r.ok || !data?.docs) throw new Error(`Zeff: ${data?.error ?? r.status}`);
  return { account: data.account ?? "", pages: data.docs };
}

export type ZeffCatalogEntry = { id: string; name: string; kind: "source" | "database"; count: number; selected: boolean };

/** What can be read from Zeff: each source (Jira, Teams, Mail …) and each database of its Workspace — to pick from. */
export async function zeffCatalog(): Promise<ZeffCatalogEntry[]> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.KNOWLEDGE_TOKEN) headers.authorization = `Bearer ${process.env.KNOWLEDGE_TOKEN}`;
  const r = await fetch(`${zeffUrl()}/api/knowledge/export?account=${encodeURIComponent(ACCOUNT)}&catalog=1`, { headers, signal: AbortSignal.timeout(120000), cache: "no-store" }).catch(() => null);
  if (!r) throw new Error(`Zeff doesn't answer (${zeffUrl()}).`);
  const data = (await r.json().catch(() => null)) as { catalog?: ZeffCatalogEntry[]; error?: string } | null;
  if (!r.ok || !data?.catalog) throw new Error(`Zeff: ${data?.error ?? r.status}`);
  return data.catalog;
}
