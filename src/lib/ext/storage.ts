import fs from "node:fs";
import path from "node:path";
import { accountDir, currentAccountId } from "@/db/accounts";

/**
 * A plugin's own small store (JSON values by key), per account: <account folder>/plugin-data/<id>/
 * storage.json. For settings and state a plugin keeps — not for big data (1 MB in all).
 */

const MAX_BYTES = 1_000_000;
const MAX_KEY = 200;

const file = (id: string) => path.join(/*turbopackIgnore: true*/ accountDir(currentAccountId()), "plugin-data", id, "storage.json");

function read(id: string): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file(id), "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function write(id: string, data: Record<string, unknown>): void {
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("The plugin's storage is full (1 MB).");
  const f = file(id);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, text);
  fs.renameSync(/*turbopackIgnore: true*/ tmp, f);
}

function checkKey(key: unknown): string {
  if (typeof key !== "string" || !key || key.length > MAX_KEY) throw new Error(`key: a text of 1–${MAX_KEY} characters`);
  return key;
}

export const storageGet = (id: string, key: unknown): unknown => read(id)[checkKey(key)] ?? null;
export const storageKeys = (id: string): string[] => Object.keys(read(id)).sort();

export function storageSet(id: string, key: unknown, value: unknown): void {
  const k = checkKey(key);
  if (value === undefined) throw new Error("value: required (JSON)");
  write(id, { ...read(id), [k]: value });
}

export function storageDelete(id: string, key: unknown): void {
  const data = read(id);
  delete data[checkKey(key)];
  write(id, data);
}
