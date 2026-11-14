import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import type { Manifest } from "./manifest";

/**
 * What the user sets for an external plugin (a manifest's `contributes.settings`, capability B of docs/plugins/runtime-conversion.md):
 * texts, numbers, choices, switches — and secrets (an API key), kept encrypted (AES-256-GCM) with a key in a file of its own beside the
 * data (`<data>/.secret-key`), never in the database: a copied database alone gives no secret away. Per account, like everything a
 * plugin keeps. A secret is never shown again once saved: the form says only whether one is set. The plugin's own functions get the
 * values as `inputs.zeffSettings` (notebook/functions.ts) — no other plugin does. Server only.
 */

type Setting = Manifest["contributes"]["settings"][number];
type Value = string | number | boolean;
type Stored = Record<string, Value | { enc: string }>;

const KEY = (plugin: string) => `ext:settings:${plugin}`;
const keyFile = () => path.join(/*turbopackIgnore: true*/ BASE_DIR, ".secret-key");

/** The key secrets are encrypted with: made once, kept beside the data (only this user may read it). */
function secretKey(): Buffer {
  try {
    const k = fs.readFileSync(/*turbopackIgnore: true*/ keyFile());
    if (k.length === 32) return k;
  } catch {
    /* (not made yet) */
  }
  const k = crypto.randomBytes(32);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ keyFile(), k, { mode: 0o600, flag: "wx" });
  return k;
}

export function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
}

export function unseal(sealed: string): string {
  const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

const declared = (m: Manifest): Setting[] => m.contributes.settings ?? [];

/** A value as its kind wants it; what doesn't fit is refused, said in words. */
function checked(s: Setting, v: unknown): Value | null {
  if (v === null || v === undefined || v === "") return null;
  if (s.kind === "number") {
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) throw new Error(`${s.label}: a number.`);
    return n;
  }
  if (s.kind === "checkbox") return v === true || v === "true" || v === "on";
  const t = String(v).slice(0, 4000);
  if (s.kind === "select" && s.options?.length && !s.options.includes(t)) throw new Error(`${s.label}: one of ${s.options.join(", ")}.`);
  return t;
}

/** The plugin's settings as its functions get them: secrets in clear, defaults filled in. */
export function pluginSettings(plugin: string, manifest: Manifest): Record<string, Value | null> {
  const stored = getPref<Stored>(KEY(plugin), {});
  const out: Record<string, Value | null> = {};
  for (const s of declared(manifest)) {
    const v = stored[s.key];
    if (v && typeof v === "object" && "enc" in v) {
      try {
        out[s.key] = unseal(v.enc);
      } catch {
        out[s.key] = null; // (the key file changed: set it again)
      }
    } else out[s.key] = v ?? s.default ?? null;
  }
  return out;
}

/** What the form shows: every setting, its value — a secret only as set or not, never its text. */
export function settingsView(plugin: string, manifest: Manifest): (Setting & { value: Value | null; isSet: boolean })[] {
  const stored = getPref<Stored>(KEY(plugin), {});
  return declared(manifest).map((s) => {
    const v = stored[s.key];
    const isSet = v !== undefined && v !== null && v !== "";
    return { ...s, value: s.kind === "secret" ? null : ((v as Value | undefined) ?? s.default ?? null), isSet };
  });
}

/** Settings saved (only those the manifest declares). A secret left empty keeps the one set; `clear` names those to remove. */
export function saveSettings(plugin: string, manifest: Manifest, values: Record<string, unknown>, clear: string[] = []): void {
  const stored = { ...getPref<Stored>(KEY(plugin), {}) };
  for (const s of declared(manifest)) {
    if (clear.includes(s.key)) {
      delete stored[s.key];
      continue;
    }
    if (!(s.key in values)) continue;
    const v = checked(s, values[s.key]);
    if (s.kind === "secret") {
      if (v !== null) stored[s.key] = { enc: seal(String(v)) };
    } else if (v === null) delete stored[s.key];
    else stored[s.key] = v;
  }
  setPref(KEY(plugin), stored);
}

/** The required settings not set yet (the plugin's "Set up" step). */
export function missingSettings(plugin: string, manifest: Manifest): string[] {
  const v = pluginSettings(plugin, manifest);
  return declared(manifest).filter((s) => s.required && (v[s.key] === null || v[s.key] === "")).map((s) => s.label);
}
