import { createHash } from "node:crypto";
import fs from "node:fs";
import { getSqlite } from "@/db";
import { caseRefs } from "@/lib/boards/similar";
import { ibanValid } from "@/lib/girocode";
import { addManualTodo, addTodoUserNote, listTodos, setTodoDue, setTodoOps, setTodoStatus } from "@/lib/boards/store";
import { detailsOf } from "@/plugins/people/details";
import { getPerson } from "@/plugins/people/store";
import { documentFile } from "@/plugins/documents/store";
import { isInstalled } from "@/plugins/state";
import { caseTitle } from "./shared";
import { caseByKey, getCase, listCases } from "./store";

/**
 * The bank (the Cases plugin): your account's bookings — read from a statement (Revolut's export, any CSV with a date,
 * an amount and a text) or fetched from a bank connection — matched to what you owe. A payment out that fits a todo's
 * transfer (the amount, and the recipient, the account or the case number) settles the todo with a note and counts for
 * its case; a case's open amount follows. An instalment ten days late, with nothing paid, makes a todo before the plan
 * lapses. And one overview of every debt, with the months ahead against your income. Server only.
 */

export type Booking = { date: string; amount: number; currency: string; text: string; counterparty: string; iban: string; reference: string };
export type Transaction = Booking & { id: string; account: string; caseId: number | null; todoId: number | null };

// ---------------------------------------------------------------------------
// Reading a statement
// ---------------------------------------------------------------------------

/** The cells of a CSV line (quotes, doubled quotes inside them). */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The columns a statement may have, by what they are called (Revolut, German banks, English ones) — the first found wins. */
const COLUMNS = {
  date: ["completed date", "datum des abschlusses", "buchungstag", "buchungsdatum", "datum", "date", "booking date", "started date", "datum des beginns", "valutadatum", "wertstellung"],
  amount: ["amount", "betrag", "betrag (eur)", "umsatz", "betrag in eur"],
  text: ["description", "beschreibung", "buchungstext", "text", "details"],
  counterparty: ["empfänger", "zahlungsempfänger", "auftraggeber", "name", "counterparty", "beguenstigter/zahlungspflichtiger", "begünstigter/zahlungspflichtiger", "zahlungsempfänger*in"],
  reference: ["verwendungszweck", "reference", "referenz", "payment reference"],
  iban: ["iban", "kontonummer/iban", "iban des empfängers"],
  currency: ["currency", "währung", "waehrung"],
  state: ["state", "status"],
} as const;

/** "-11.52", "-300,00", "1.234,56", "1,234.56" → a number (NaN when it is none). */
function amountOf(s: string): number {
  const v = s.replace(/[€\s]|EUR/gi, "");
  if (/,\d{1,2}$/.test(v)) return Number(v.replace(/\./g, "").replace(",", "."));
  return Number(v.replace(/,/g, ""));
}

/** "2026-10-17 09:12:05", "17.10.2026", "17.10.26" → "2026-10-17" (empty when it is none). */
function dayOf(s: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
  if (de) return `${de[3].length === 2 ? `20${de[3]}` : de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  return "";
}

/** Revolut writes the other side into the description: "To Nathanael Dienstkonto", "Transfer to …", "From …". */
const fromText = (text: string) => /^(?:transfer\s+)?(?:to|from|an|von)\s+(.+)$/i.exec(text.trim())?.[1]?.trim() ?? "";

/** The bookings of a statement (CSV, comma or semicolon) — the ones not yet completed (Revolut's PENDING) left for later. */
export function parseStatement(csv: string): Booking[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = cells(lines[0], sep).map((h) => h.toLowerCase().replace(/^"|"$/g, ""));
  const col = (names: readonly string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const at = { date: col(COLUMNS.date), amount: col(COLUMNS.amount), text: col(COLUMNS.text), counterparty: col(COLUMNS.counterparty), reference: col(COLUMNS.reference), iban: col(COLUMNS.iban), currency: col(COLUMNS.currency), state: col(COLUMNS.state) };
  if (at.date < 0 || at.amount < 0) throw new Error("The statement needs a date and an amount column.");
  const out: Booking[] = [];
  for (const line of lines.slice(1)) {
    const c = cells(line, sep);
    const get = (i: number) => (i >= 0 ? (c[i] ?? "") : "");
    const state = get(at.state).toUpperCase();
    if (state && !["COMPLETED", "ABGESCHLOSSEN", "GEBUCHT", "BOOKED"].includes(state)) continue;
    const date = dayOf(get(at.date)) || dayOf(get(col(["started date", "datum des beginns"])));
    const amount = amountOf(get(at.amount));
    if (!date || !Number.isFinite(amount)) continue;
    const text = get(at.text) || get(at.reference) || get(at.counterparty);
    const iban = get(at.iban).replace(/\s+/g, "").toUpperCase();
    out.push({ date, amount, currency: get(at.currency) || "EUR", text, counterparty: get(at.counterparty) || fromText(text), iban: ibanValid(iban) ? iban : "", reference: at.reference !== at.text ? get(at.reference) : "" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading a PDF statement (Revolut): by where its words stand
// ---------------------------------------------------------------------------

export type PlacedWord = { x: number; y: number; text: string };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12 };

/** "23.02.2026", "Oct 17, 2026", "17. Okt. 2026" → "2026-10-17"; empty when it is no date. */
function dateOfWords(s: string): string {
  const de = dayOf(s.trim());
  if (de) return de;
  const en = /^([A-Za-zä]{3})[a-zä]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s.trim());
  if (en && MONTHS[en[1].toLowerCase()]) return `${en[3]}-${String(MONTHS[en[1].toLowerCase()]).padStart(2, "0")}-${en[2].padStart(2, "0")}`;
  const dm = /^(\d{1,2})\.\s+([A-Za-zä]{3})[a-zä]*\.?\s+(\d{4})$/.exec(s.trim());
  if (dm && MONTHS[dm[2].toLowerCase()]) return `${dm[3]}-${String(MONTHS[dm[2].toLowerCase()]).padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  return "";
}

type Columns = { date: number; text: number; out: number; in: number; balance: number };

/** The columns of a statement's table, by its head line: Datum / Beschreibung / Geldausgang / Geldeingang / Kontostand (or English). */
function columnsOf(line: PlacedWord[]): Columns | null {
  const at = (re: RegExp) => line.find((w) => re.test(w.text))?.x;
  const date = at(/^(Datum|Date)$/i);
  const text = at(/^(Beschreibung|Description)$/i);
  const balance = at(/^(Kontostand|Saldo|Balance)$/i);
  let out = at(/^Geldausgang$/i);
  let inn = at(/^Geldeingang$/i);
  if (out === undefined || inn === undefined) {
    // "Money out" / "Money in": the word before each.
    const money = line.filter((w) => /^Money$/i.test(w.text)).map((w) => ({ w, next: line.find((n) => n.x > w.x && Math.abs(n.y - w.y) < 3 && n !== w) })).sort((a, b) => a.w.x - b.w.x);
    out ??= money.find((m) => /^out$/i.test(m.next?.text ?? ""))?.w.x;
    inn ??= money.find((m) => /^in$/i.test(m.next?.text ?? ""))?.w.x;
  }
  return date !== undefined && text !== undefined && out !== undefined && inn !== undefined && balance !== undefined ? { date, text, out, in: inn, balance } : null;
}

/** The words of a page in lines (by their height, top first), each line left to right. */
function linesOf(words: PlacedWord[]): PlacedWord[][] {
  const lines: PlacedWord[][] = [];
  for (const w of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - w.y) <= 3) line.push(w);
    else lines.push([w]);
  }
  return lines.map((l) => l.sort((a, b) => a.x - b.x));
}

const isAmount = (s: string) => /^[€$£]?-?[\d.,]+[€$£]?$/.test(s) && /\d[.,]\d{2}[€$£]?$/.test(s);

/**
 * A PDF statement's bookings from its words and where they stand (pdf.ts reads them): a line with a date opens a booking —
 * its description, and its amount in the out or the in column; the lines under it without a date ("An: name, IBAN",
 * "Referenz: …", "Karte: …") belong to it. Pages without a head line go on with the last one's columns.
 */
export function bookingsFromWords(pages: PlacedWord[][]): Booking[] {
  const out: Booking[] = [];
  let cols: Columns | null = null;
  for (const page of pages) {
    let open: (Booking & { lines: string[] }) | null = null;
    const close = () => {
      if (!open) return;
      const { lines: _l, ...b } = open;
      out.push(b);
      open = null;
    };
    for (const line of linesOf(page)) {
      const head = columnsOf(line);
      if (head) {
        close();
        cols = head;
        continue;
      }
      if (!cols) continue;
      const c: Columns = cols;
      const dateWords = line.filter((w) => w.x < c.text - 4);
      const date = dateOfWords(dateWords.map((w) => w.text).join(" "));
      const desc = line.filter((w) => w.x >= c.text - 4 && w.x < c.out - 20 && !isAmount(w.text)).map((w) => w.text).join(" ").trim();
      const amounts = line.filter((w) => w.x >= c.out - 20 && isAmount(w.text));
      if (date) {
        close();
        // The amount by its column: the out column's, else the in column's (the balance is neither).
        const nearest = (x: number) => (["out", "in", "balance"] as const).reduce((best, k) => (Math.abs(c[k] - x) < Math.abs(c[best] - x) ? k : best), "out" as "out" | "in" | "balance");
        const outAmt = amounts.find((a) => nearest(a.x) === "out");
        const inAmt = amounts.find((a) => nearest(a.x) === "in");
        const value = outAmt ? -Math.abs(amountOf(outAmt.text)) : inAmt ? Math.abs(amountOf(inAmt.text)) : NaN;
        if (!Number.isFinite(value)) continue;
        open = { date, amount: value, currency: /\$/.test((outAmt ?? inAmt)!.text) ? "USD" : "EUR", text: desc, counterparty: /^(?:to|an|von|from)\s+/i.test(desc) ? fromText(desc) : (/^zahlung von\s+(.+)$/i.exec(desc)?.[1] ?? ""), iban: "", reference: "", lines: [] };
        continue;
      }
      // A line under the booking: what it says about it — or, far left (a footer), its end.
      if (!open || !desc || dateWords.length) {
        if (dateWords.length) close();
        continue;
      }
      const o: Booking & { lines: string[] } = open;
      const ref = /^(?:Referenz|Reference):\s*(.*)$/i.exec(desc);
      const party = /^(?:An|Von|To|From):\s*(.*)$/i.exec(desc);
      if (ref) o.reference = ref[1].trim();
      else if (party) {
        const [name, rest] = party[1].split(/,\s*/, 2);
        const iban = (rest ?? "").replace(/\s+/g, "").toUpperCase();
        if (ibanValid(iban)) o.iban = iban;
        if (!o.counterparty || ibanValid(iban)) o.counterparty = name.trim();
      }
      o.lines.push(desc);
    }
    close();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kept
// ---------------------------------------------------------------------------

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists bank_transactions (id text primary key, account text not null, date text not null, amount real not null, currency text not null default 'EUR', text text not null default '', counterparty text not null default '', iban text not null default '', reference text not null default '', imported_at text not null, case_id integer, todo_id integer, matched_at text);
    create index if not exists bank_transactions_date on bank_transactions (date);
    create table if not exists case_payments (case_id integer not null references cases(id) on delete cascade, tx_id text not null unique, amount real not null, date text not null);
    create table if not exists case_warnings (case_id integer not null, due text not null, todo_id integer, at text not null, primary key (case_id, due));
  `);
  return d;
}

type TRow = { id: string; account: string; date: string; amount: number; currency: string; text: string; counterparty: string; iban: string; reference: string; case_id: number | null; todo_id: number | null };
const toTx = (r: TRow): Transaction => ({ id: r.id, account: r.account, date: r.date, amount: r.amount, currency: r.currency, text: r.text, counterparty: r.counterparty, iban: r.iban, reference: r.reference, caseId: r.case_id, todoId: r.todo_id });

/** Bookings kept — the same booking (account, day, amount, text, and which of its like it is) once, however often it is read. */
export function addBookings(bookings: Booking[], account: string): { added: number; total: number } {
  const seen = new Map<string, number>();
  const insert = db().prepare("insert or ignore into bank_transactions (id, account, date, amount, currency, text, counterparty, iban, reference, imported_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let added = 0;
  for (const b of bookings) {
    const sig = [account, b.date, b.amount.toFixed(2), b.text].join("|");
    const n = (seen.get(sig) ?? 0) + 1;
    seen.set(sig, n);
    const id = createHash("sha1").update(`${sig}|${n}`).digest("hex").slice(0, 20);
    added += insert.run(id, account, b.date, b.amount, b.currency, b.text.slice(0, 300), b.counterparty.slice(0, 120), b.iban, b.reference.slice(0, 300), new Date().toISOString()).changes;
  }
  return { added, total: bookings.length };
}

/** A statement read and kept. */
export const importStatement = (csv: string, account: string) => addBookings(parseStatement(csv), account);

/**
 * The statements among the documents (a CSV from your Drive folder, one you dropped in): read by themselves, each once —
 * a CSV is one when it has a date and an amount column. The account is named after the bank its name or columns say.
 */
export function importStatementDocuments(): { documents: number; added: number } {
  const d = db();
  d.exec("create table if not exists bank_documents (doc_id integer primary key, added integer not null, at text not null)");
  const done = new Set((d.prepare("select doc_id from bank_documents").all() as { doc_id: number }[]).map((r) => r.doc_id));
  let rows: { id: number; name: string; mime: string }[] = [];
  try {
    rows = d.prepare("select id, name, mime from documents where lower(name) like '%.csv' or mime = 'text/csv'").all() as typeof rows;
  } catch {
    return { documents: 0, added: 0 }; // the Documents plugin never ran
  }
  let documents = 0;
  let added = 0;
  for (const doc of rows.filter((r) => !done.has(r.id))) {
    const file = documentFile(doc.id);
    let n = 0;
    if (file) {
      const csv = fs.readFileSync(file.path, "utf8");
      let bookings: Booking[] = [];
      try {
        bookings = parseStatement(csv);
      } catch {
        bookings = []; // no date and amount: no statement
      }
      if (bookings.length) {
        const account = /revolut/i.test(doc.name) || /^Art,Produkt,|^Type,Product,/.test(csv) ? "Revolut" : doc.name.replace(/\.csv$/i, "").slice(0, 40);
        n = addBookings(bookings, account).added;
        documents++;
        added += n;
      }
    }
    d.prepare("insert or replace into bank_documents (doc_id, added, at) values (?, ?, ?)").run(doc.id, n, new Date().toISOString());
  }
  return { documents, added };
}

export const listTransactions = (limit = 500): Transaction[] => (db().prepare("select * from bank_transactions order by date desc, id limit ?").all(limit) as TRow[]).map(toTx);

export const paymentsOf = (caseId: number): { amount: number; date: string; txId: string }[] =>
  (db().prepare("select amount, date, tx_id txId from case_payments where case_id = ? order by date").all(caseId) as { amount: number; date: string; txId: string }[]).map((r) => ({ ...r }));

/** What is paid on a case since its summary was made, and what is open now. */
export function caseStanding(caseId: number): { paidSince: number; open: number | null; last: { date: string; amount: number } | null } {
  const c = getCase(caseId);
  const all = paymentsOf(caseId);
  const since = c?.compiled?.at?.slice(0, 10) ?? "";
  const paidSince = all.filter((p) => p.date >= since).reduce((s, p) => s + p.amount, 0);
  const open = c?.compiled?.open != null ? Math.max(0, Math.round((c.compiled.open - paidSince) * 100) / 100) : null;
  const last = all.at(-1);
  return { paidSince, open, last: last ? { date: last.date, amount: last.amount } : null };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** The words of a name worth comparing (four letters and more). */
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
/** Whether a booking's other side is this recipient: a word of the name in what the booking says. */
const namesIt = (tx: Transaction, name: string) => {
  const said = new Set(words(`${tx.counterparty} ${tx.text}`));
  return words(name).some((w) => said.has(w));
};
const sameAmount = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;
const euro = (v: number) => `${Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;
const deDay = (day: string) => day.split("-").reverse().join(".");

/**
 * The payments out not matched yet, matched: to an open todo's transfer (the amount, and the recipient, the account or the case
 * number) — the todo is done, with a note — and to its case; else to a case by its account or name and its instalment or open
 * amount. How many were matched.
 */
export function matchPayments(): { matched: number } {
  const d = db();
  const open = (d.prepare("select * from bank_transactions where amount < 0 and case_id is null and todo_id is null order by date").all() as TRow[]).map(toTx);
  if (!open.length) return { matched: 0 };
  const todos = isInstalled("todos") ? listTodosWithTransfer() : [];
  const cases = listCases().filter((c) => c.status === "open");
  let matched = 0;
  for (const tx of open) {
    const refs = caseRefs(`${tx.reference} ${tx.text}`);
    const todo = todos.find(
      (x) => !x.done && sameAmount(tx.amount, Number(x.op.amount)) && (namesIt(tx, x.op.name) || (tx.iban && tx.iban === x.op.iban.replace(/\s+/g, "")) || caseRefs(x.op.purpose).some((r) => refs.includes(r))),
    );
    let caseId: number | null = null;
    if (todo) caseId = caseRefs(todo.op.purpose).map((r) => caseByKey(r.replace(/^\d{1,2} /, ""))?.id).find((id): id is number => !!id) ?? null;
    if (!caseId) {
      const c = cases.find((c) => {
        const s = c.compiled;
        if (!s) return false;
        const who = (s.iban && tx.iban === s.iban.replace(/\s+/g, "")) || refs.some((r) => r.replace(/^\d{1,2} /, "") === c.key) || (s.payee && namesIt(tx, s.payee));
        return who && [s.installment, s.open].some((v) => v != null && sameAmount(tx.amount, v));
      });
      caseId = c?.id ?? null;
    }
    // The same payment read twice (a statement and the bank connection): counted once.
    const twin = caseId && paymentsOf(caseId).some((p) => sameAmount(p.amount, tx.amount) && Math.abs(Date.parse(p.date) - Date.parse(tx.date)) <= 2 * 864e5);
    if (twin) {
      d.prepare("update bank_transactions set case_id = ?, matched_at = ? where id = ?").run(caseId, new Date().toISOString(), tx.id);
      continue;
    }
    if (!todo && !caseId) continue;
    d.prepare("update bank_transactions set case_id = ?, todo_id = ?, matched_at = ? where id = ?").run(caseId, todo?.id ?? null, new Date().toISOString(), tx.id);
    if (caseId) d.prepare("insert or ignore into case_payments (case_id, tx_id, amount, date) values (?, ?, ?, ?)").run(caseId, tx.id, Math.abs(tx.amount), tx.date);
    if (todo) {
      settleTodo(todo.id, `✓ Bezahlt laut Kontoauszug (${tx.account}, ${deDay(tx.date)}): ${euro(tx.amount)} an ${tx.counterparty || todo.op.name}.`);
      todo.done = true;
    }
    matched++;
  }
  return { matched };
}

type TransferOp = { name: string; iban: string; amount: string; purpose: string };

/** The open todos with a transfer on them. */
function listTodosWithTransfer(): { id: number; op: TransferOp; done: boolean }[] {
  return listTodos({ status: "open" }).flatMap((t) => t.ops.filter((o) => o.type === "bank-transfer").map((o) => ({ id: t.id, op: o as unknown as TransferOp, done: false })));
}

function settleTodo(id: number, note: string): void {
  addTodoUserNote(id, note);
  setTodoStatus(id, "done", note);
}

// ---------------------------------------------------------------------------
// Warning before a plan lapses
// ---------------------------------------------------------------------------

const LATE_DAYS = 10;

/** The instalments ten days late, with nothing paid since they were due: a todo each (once), with the transfer on it. How many. */
export function overdueWarnings(today: string): number {
  if (!isInstalled("todos")) return 0;
  const d = db();
  let made = 0;
  for (const c of listCases().filter((x) => x.status === "open" && !x.compiled?.done)) {
    const s = c.compiled;
    if (!s?.nextDue || s.installment == null) continue;
    const late = Math.round((Date.parse(today) - Date.parse(s.nextDue)) / 864e5);
    if (late < LATE_DAYS) continue;
    if (paymentsOf(c.id).some((p) => p.date >= s.nextDue!)) continue;
    if (d.prepare("select 1 from case_warnings where case_id = ? and due = ?").get(c.id, s.nextDue)) continue;
    // In German, like the todos Zeff makes from your mails.
    const text = `Rate ${euro(s.installment)} (Az. ${c.label}) seit ${late} Tagen überfällig — überweisen, bevor der Ratenplan verfällt (${caseTitle(c)})`;
    const todo = addManualTodo({ ticket: "", text });
    setTodoDue(todo.id, today);
    if (s.iban && !todo.ops.some((o) => o.type === "bank-transfer")) setTodoOps(todo.id, [...todo.ops, { type: "bank-transfer", name: s.payee || s.party, iban: s.iban, bic: s.bic, amount: s.installment.toFixed(2), purpose: s.purpose || c.label }], undefined, true);
    d.prepare("insert into case_warnings (case_id, due, todo_id, at) values (?, ?, ?, ?)").run(c.id, s.nextDue, todo.id, new Date().toISOString());
    made++;
  }
  return made;
}

// ---------------------------------------------------------------------------
// The overview of the debts
// ---------------------------------------------------------------------------

export type DebtRow = { caseId: number; creditor: string; caseNumber: string; person: string; total: number | null; open: number | null; installment: number | null; nextDue: string | null; nextWhat: string; last: { date: string; amount: number } | null; contact: string; iban: string };
export type DebtOverview = { rows: DebtRow[]; totals: { total: number; open: number; installments: number }; months: { month: string; installments: number; left: number | null }[]; income: number | null };

/** Every running case as a debt — and the next six months: the instalments due in each, what is left of your income. */
export function debtOverview(opts: { income?: number | null; today?: string } = {}): DebtOverview {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const people = isInstalled("people");
  const rows: DebtRow[] = listCases()
    .filter((c) => c.status === "open" && !c.compiled?.done)
    .map((c) => {
      const s = c.compiled;
      const p = c.personId && people ? getPerson(c.personId) : null;
      const details = p ? detailsOf(p.id) : [];
      const contact = [p?.name, ...(p?.emails ?? []), ...details.filter((x) => x.key === "phone" || x.key === "address").map((x) => x.value)].filter(Boolean).join(" · ");
      const standing = caseStanding(c.id);
      return { caseId: c.id, creditor: s?.party || caseTitle(c), caseNumber: c.label, person: p?.name ?? "", total: s?.total ?? null, open: standing.open, installment: s?.installment ?? null, nextDue: s?.nextDue ?? null, nextWhat: s?.nextWhat ?? "", last: standing.last, contact, iban: s?.iban ?? "" };
    })
    .sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
  const totals = { total: rows.reduce((s, r) => s + (r.total ?? 0), 0), open: rows.reduce((s, r) => s + (r.open ?? 0), 0), installments: rows.reduce((s, r) => s + (r.installment ?? 0), 0) };
  const income = opts.income ?? null;
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);
    // The instalments still running that month: what is open isn't paid off before it.
    const installments = rows.filter((r) => r.installment != null && (r.open == null || r.open > r.installment * i)).reduce((s, r) => s + r.installment!, 0);
    return { month, installments, left: income != null ? Math.round((income - installments) * 100) / 100 : null };
  });
  return { rows, totals, months, income };
}
