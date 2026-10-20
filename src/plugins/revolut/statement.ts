import fs from "node:fs";
import { getSqlite } from "@/db";
import { ibanValid } from "@/lib/girocode";
import { addBookings, type Booking } from "@/plugins/cases/bank";
import { documentFile } from "@/plugins/documents/store";

/**
 * Revolut's statements (the Revolut plugin): the CSV export — or any bank's CSV with a date, an amount and a text — read
 * into the cases' bank (its bookings kept there, matched to what you owe). A file you import, or one that comes in as a
 * document (your Drive folder) by itself. Server only.
 */

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

/** The account a statement is of: Revolut by its file name ("account-statement_…") or its columns, else the file's name. */
export const accountOf = (name: string, csv: string): string =>
  /revolut|^account-statement_/i.test(name) || /^(Art,Produkt|Type,Product),/.test(csv.replace(/^﻿/, "")) ? "Revolut" : name.replace(/\.csv$/i, "").slice(0, 40) || "Bank";

/** A statement read and kept (in the cases' bank). */
export const importStatement = (csv: string, account: string) => addBookings(parseStatement(csv), account);

const deDay = (day: string) => day.split("-").reverse().join(".");

/**
 * A statement among the documents (a CSV with a date and an amount column): a note of what it is, kept as the document's
 * text in place of its bookings — they would reach the knowledge, the people and the cases as if they were letters. Its
 * bookings are read from the file (importStatementDocuments). Null: no statement.
 */
export function statementNote(name: string, text: string): string | null {
  if (!/\.csv$/i.test(name) && !/^[^\n]*[,;][^\n]*\n/.test(text)) return null;
  let days: string[];
  try {
    days = parseStatement(text).map((b) => b.date);
  } catch {
    return null; // no date and amount: no statement
  }
  if (days.length < 2) return null;
  days.sort();
  const account = accountOf(name, text);
  // In German, like the rest of what Zeff keeps of your letters.
  return `Kontoauszug${account === "Revolut" ? " (Revolut)" : ""}, ${days.length.toLocaleString("de-DE")} Buchungen vom ${deDay(days[0])} bis ${deDay(days.at(-1)!)}. Die Buchungen liest die Bank (Vorgänge) aus der Datei; sie werden nicht als Text übernommen.`;
}

/**
 * The statements among the documents (a CSV from your Drive folder, one you dropped in): read by themselves, each once —
 * a CSV is one when it has a date and an amount column.
 */
export function importStatementDocuments(): { documents: number; added: number } {
  const d = getSqlite();
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
        n = addBookings(bookings, accountOf(doc.name, csv)).added;
        documents++;
        added += n;
      }
    }
    d.prepare("insert or replace into bank_documents (doc_id, added, at) values (?, ?, ?)").run(doc.id, n, new Date().toISOString());
  }
  return { documents, added };
}
