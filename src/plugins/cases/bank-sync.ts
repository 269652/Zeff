import { createSign, randomUUID } from "node:crypto";
import { getPref, setPref } from "@/lib/prefs";
import { addBookings, type Booking } from "./bank";
import { localDay } from "@/lib/dates";

/**
 * The bank connection (the Cases plugin): your account's bookings fetched through Enable Banking, an Open Banking service
 * that is free for your own accounts ("restricted" mode). You make an application there, link your bank (Revolut) in its
 * control panel and give Zeff the application's id and private key; Zeff then asks your bank once for access (you sign in
 * at your bank) and fetches the bookings after each briefing and on a click. The key stays in this account's settings.
 * Server only.
 */

const API = "https://api.enablebanking.com";
const PREF = "cases.bank";

export type BankSettings = { appId: string; privateKey: string; aspsp: string; country: string; sessionId: string | null; accounts: string[]; validUntil: string | null; lastSync: string | null };

export const bankSettings = (): BankSettings | null => getPref<BankSettings | null>(PREF, null);
const save = (patch: Partial<BankSettings>) => setPref(PREF, { ...(bankSettings() ?? { appId: "", privateKey: "", aspsp: "Revolut", country: "DE", sessionId: null, accounts: [], validUntil: null, lastSync: null }), ...patch });

/** Whether bookings can be fetched: an application, a session with accounts. */
export const bankConnected = (): boolean => {
  const s = bankSettings();
  return !!(s?.appId && s.privateKey && s.sessionId && s.accounts.length);
};

/** The application's token for Enable Banking's API: a JWT, RS256, the application id as its key id, valid an hour. */
export function appToken(s: Pick<BankSettings, "appId" | "privateKey">, now = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ typ: "JWT", alg: "RS256", kid: s.appId });
  const body = b64({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 });
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(s.privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

type Fetch = typeof fetch;

async function call<T>(s: BankSettings, path: string, init: RequestInit = {}, f: Fetch = fetch): Promise<T> {
  const r = await f(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${appToken(s)}`, "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) } });
  if (!r.ok) throw new Error(`Enable Banking: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T;
}

/** The application's id and key, the bank and its country — kept (a new key or bank: connect again). */
export function saveBankSettings(v: { appId: string; privateKey?: string; aspsp: string; country: string }): void {
  const had = bankSettings();
  const key = v.privateKey?.trim() || had?.privateKey || "";
  if (!v.appId.trim() || !/BEGIN (RSA )?PRIVATE KEY/.test(key)) throw new Error("The application id and its private key (PEM) are needed.");
  const changed = !had || had.appId !== v.appId.trim() || had.aspsp !== v.aspsp || had.country !== v.country || (v.privateKey?.trim() && v.privateKey.trim() !== had.privateKey);
  save({ appId: v.appId.trim(), privateKey: key, aspsp: v.aspsp.trim() || "Revolut", country: v.country.trim().toUpperCase() || "DE", ...(changed ? { sessionId: null, accounts: [], validUntil: null } : {}) });
}

/** The address at your bank to sign in and allow access (90 days) — it comes back to `redirectUrl` with a code. */
export async function startBankAuth(redirectUrl: string, f: Fetch = fetch): Promise<{ url: string; state: string }> {
  const s = bankSettings();
  if (!s?.appId || !s.privateKey) throw new Error("Set up the bank connection first (application id and key).");
  const state = randomUUID();
  const validUntil = new Date(Date.now() + 90 * 864e5).toISOString();
  const r = await call<{ url: string }>(s, "/auth", { method: "POST", body: JSON.stringify({ access: { valid_until: validUntil }, aspsp: { name: s.aspsp, country: s.country }, state, redirect_url: redirectUrl, psu_type: "personal" }) }, f);
  setPref(`${PREF}.state`, state);
  return { url: r.url, state };
}

/** The code your bank sent back: the session and its accounts kept. */
export async function finishBankAuth(code: string, state: string, f: Fetch = fetch): Promise<{ accounts: number }> {
  const s = bankSettings();
  if (!s) throw new Error("No bank connection set up.");
  if (state !== getPref<string | null>(`${PREF}.state`, null)) throw new Error("This sign-in wasn't started here.");
  const r = await call<{ session_id: string; accounts: { uid: string }[]; access?: { valid_until?: string } }>(s, "/sessions", { method: "POST", body: JSON.stringify({ code }) }, f);
  save({ sessionId: r.session_id, accounts: r.accounts.map((a) => a.uid), validUntil: r.access?.valid_until ?? null });
  setPref(`${PREF}.state`, null);
  return { accounts: r.accounts.length };
}

type EbTransaction = {
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "DBIT" | "CRDT";
  booking_date?: string;
  value_date?: string;
  status?: string;
  creditor?: { name?: string };
  debtor?: { name?: string };
  creditor_account?: { iban?: string };
  debtor_account?: { iban?: string };
  remittance_information?: string[];
};

/** A transaction as a booking: out negative (to its creditor), in positive (from its debtor) — a pending one none yet. */
export function toBooking(x: EbTransaction): Booking | null {
  if (x.status && x.status !== "BOOK") return null;
  const date = (x.booking_date || x.value_date || "").slice(0, 10);
  const n = Number(x.transaction_amount?.amount);
  if (!date || !Number.isFinite(n)) return null;
  const out = x.credit_debit_indicator === "DBIT";
  const counterparty = (out ? x.creditor?.name : x.debtor?.name) ?? "";
  const reference = (x.remittance_information ?? []).join(" ").trim();
  return { date, amount: out ? -Math.abs(n) : Math.abs(n), currency: x.transaction_amount.currency || "EUR", text: counterparty || reference, counterparty, iban: ((out ? x.creditor_account?.iban : x.debtor_account?.iban) ?? "").replace(/\s+/g, ""), reference };
}

/** Every account's bookings since the last fetch (a week back from it; 90 days the first time) — kept, each once. */
export async function syncBank(opts: { fetch?: Fetch } = {}): Promise<{ added: number; total: number }> {
  const s = bankSettings();
  if (!s || !bankConnected()) throw new Error("The bank isn't connected.");
  if (s.validUntil && s.validUntil < new Date().toISOString()) throw new Error("The bank's access has expired — connect again.");
  const from = localDay(new Date(s.lastSync ? Date.parse(s.lastSync) - 7 * 864e5 : Date.now() - 90 * 864e5));
  let added = 0;
  let total = 0;
  for (const uid of s.accounts) {
    let key: string | undefined;
    const bookings: Booking[] = [];
    do {
      const q = new URLSearchParams({ date_from: from, ...(key ? { continuation_key: key } : {}) });
      const r = await call<{ transactions: EbTransaction[]; continuation_key?: string | null }>(s, `/accounts/${encodeURIComponent(uid)}/transactions?${q}`, {}, opts.fetch);
      for (const x of r.transactions ?? []) {
        const b = toBooking(x);
        if (b) bookings.push(b);
      }
      key = r.continuation_key || undefined;
    } while (key);
    const r = addBookings(bookings, s.aspsp);
    added += r.added;
    total += r.total;
  }
  save({ lastSync: new Date().toISOString() });
  return { added, total };
}
