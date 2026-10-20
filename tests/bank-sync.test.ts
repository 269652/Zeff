import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { setupTempData } from "./helpers";

setupTempData();

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("bank sync: a token Enable Banking takes — RS256, the app id as kid, its audience — signed with your key", async () => {
  const { appToken } = await import("@/plugins/cases/bank-sync");
  const jwt = appToken({ appId: "app-123", privateKey: PEM }, 1_800_000_000);
  const [h, p, s] = jwt.split(".");
  const head = JSON.parse(Buffer.from(h, "base64url").toString());
  const body = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.deepEqual(head, { typ: "JWT", alg: "RS256", kid: "app-123" });
  assert.equal(body.iss, "enablebanking.com");
  assert.equal(body.aud, "api.enablebanking.com");
  assert.ok(body.exp > body.iat && body.exp - body.iat <= 86400);
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")));
});

test("bank sync: the bank's transactions as bookings — out negative with the creditor, in positive with the debtor, pending ones left", async () => {
  const { toBooking } = await import("@/plugins/cases/bank-sync");
  assert.deepEqual(
    toBooking({ transaction_amount: { amount: "11.52", currency: "EUR" }, credit_debit_indicator: "DBIT", booking_date: "2026-10-17", status: "BOOK", creditor: { name: "Nathanael Dienstkonto" }, creditor_account: { iban: "DE22660908000007777302" }, remittance_information: ["DR II 810/26"] }),
    { date: "2026-10-17", amount: -11.52, currency: "EUR", text: "Nathanael Dienstkonto", counterparty: "Nathanael Dienstkonto", iban: "DE22660908000007777302", reference: "DR II 810/26" },
  );
  assert.equal(toBooking({ transaction_amount: { amount: "2100", currency: "EUR" }, credit_debit_indicator: "CRDT", booking_date: "2026-10-23", status: "BOOK", debtor: { name: "Acme" } })!.amount, 2100);
  assert.equal(toBooking({ transaction_amount: { amount: "300", currency: "EUR" }, credit_debit_indicator: "DBIT", value_date: "2026-10-20", status: "PDNG" }), null);
});

test("bank sync: connected, it fetches every account's bookings since the last time (all pages) and keeps them; the session ended, it says so", async () => {
  const { setPref } = await import("@/lib/prefs");
  setPref("cases.bank", { appId: "app-123", privateKey: PEM, aspsp: "Revolut", country: "DE", sessionId: "s1", accounts: ["acc1"], validUntil: "2099-01-01T00:00:00Z", lastSync: null });
  const calls: string[] = [];
  const fake = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    assert.match(String((init?.headers as Record<string, string>).Authorization), /^Bearer ey/);
    if (url.includes("continuation_key=k2")) return new Response(JSON.stringify({ transactions: [{ transaction_amount: { amount: "23.10", currency: "EUR" }, credit_debit_indicator: "DBIT", booking_date: "2026-10-18", status: "BOOK", creditor: { name: "Rewe" } }] }));
    return new Response(JSON.stringify({ transactions: [{ transaction_amount: { amount: "11.52", currency: "EUR" }, credit_debit_indicator: "DBIT", booking_date: "2026-10-17", status: "BOOK", creditor: { name: "Nathanael Dienstkonto" } }], continuation_key: "k2" }));
  };
  const { syncBank, bankConnected } = await import("@/plugins/cases/bank-sync");
  assert.equal(bankConnected(), true);
  const r = await syncBank({ fetch: fake as typeof fetch });
  assert.deepEqual(r, { added: 2, total: 2 });
  assert.match(calls[0], /^GET https:\/\/api\.enablebanking\.com\/accounts\/acc1\/transactions\?date_from=\d{4}-\d{2}-\d{2}$/);
  assert.equal(calls.length, 2);
  const { listTransactions } = await import("@/plugins/cases/bank");
  assert.equal(listTransactions().length, 2);
  setPref("cases.bank", { appId: "app-123", privateKey: PEM, aspsp: "Revolut", country: "DE", sessionId: "s1", accounts: ["acc1"], validUntil: "2000-01-01T00:00:00Z", lastSync: null });
  await assert.rejects(syncBank({ fetch: fake as typeof fetch }), /expired|abgelaufen|connect again/i);
});
