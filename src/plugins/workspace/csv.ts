/**
 * CSV in (the Workspace plugin): a table of text as a database — its delimiter found, its columns
 * typed by what is in them (number, date, checkbox, select when a few values repeat). Client-safe.
 */
import { newId, newProperty, type DbSchema, type Option, type Property, COLORS } from "./model";

/** CSV text as rows of cells: quotes, doubled quotes, newlines in quotes; the delimiter is the one used most in the first line (; , tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/)[0] ?? "";
  const delim = [";", ",", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "") || row.length > 1) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s);
const toIso = (s: string) => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
};
const isNumber = (s: string) => /^-?\d+([.,]\d+)?$/.test(s.trim());
const BOOLS = new Set(["true", "false", "yes", "no", "ja", "nein", "x", "1", "0"]);

export type CsvImport = { schema: DbSchema; rows: { title: string; cells: Record<string, unknown> }[] };

/** A database from CSV rows (the first row the headers): column types guessed from the values. */
export function csvToDatabase(table: string[][]): CsvImport {
  const [head = [], ...body] = table;
  const cols = head.map((h, i) => (h.trim() || `Column ${i + 1}`).slice(0, 80));
  const props: Property[] = [];
  const titleCol = 0;
  for (let i = 0; i < cols.length; i++) {
    if (i === titleCol) continue;
    const vals = body.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    let type: Property["type"] = "text";
    if (vals.length) {
      if (vals.every(isNumber)) type = "number";
      else if (vals.every(isDate)) type = "date";
      else if (vals.every((v) => BOOLS.has(v.toLowerCase())) && new Set(vals.map((v) => v.toLowerCase())).size <= 2) type = "checkbox";
      else if (vals.every((v) => /^https?:\/\//i.test(v))) type = "url";
      else if (vals.every((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) type = "email";
      else {
        const distinct = new Set(vals);
        if (vals.length >= 6 && distinct.size <= Math.max(3, Math.floor(vals.length / 3)) && [...distinct].every((v) => v.length <= 40)) type = "select";
      }
    }
    const p = newProperty(cols[i], type);
    if (type === "select") {
      p.options = [...new Set(vals)].map((v, k): Option => ({ id: newId("o"), name: v, color: COLORS[k % COLORS.length] }));
    }
    props.push(p);
  }
  const rows = body
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const cells: Record<string, unknown> = {};
      props.forEach((p, k) => {
        const raw = (r[k + 1] ?? "").trim();
        if (!raw) return;
        if (p.type === "number") cells[p.id] = Number(raw.replace(",", "."));
        else if (p.type === "date") cells[p.id] = toIso(raw);
        else if (p.type === "checkbox") cells[p.id] = ["true", "yes", "ja", "x", "1"].includes(raw.toLowerCase());
        else if (p.type === "select") cells[p.id] = p.options?.find((o) => o.name === raw)?.id;
        else cells[p.id] = raw;
      });
      return { title: (r[titleCol] ?? "").trim(), cells };
    });
  return { schema: { titleName: cols[titleCol] ?? "Name", properties: props, views: [{ id: newId("v"), name: "Table", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] }, rows };
}
