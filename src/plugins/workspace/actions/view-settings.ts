"use server";

import { run } from "./shared";

// ---------------------------------------------------------------------------
// Settings of an app made of views (view-settings.ts): kept per database in the account's prefs
// ---------------------------------------------------------------------------

const key = (db: number) => `workspace.viewSettings.${db}`;

/** The settings saved for a database's views (name → text). */
export async function loadViewSettingsAction(db: number) {
  return run(async () => {
    const { getPref } = await import("@/lib/prefs");
    const v = getPref<unknown>(key(Number(db)), {});
    const out: Record<string, string> = {};
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") out[k] = x;
    return { values: out };
  });
}

/** One setting saved (the view has declared it with <setting>; `decl` is what the page drew it from, checked here). */
export async function saveViewSettingAction(db: number, name: string, value: string, decl: { type: string; options?: string[] }) {
  return run(async () => {
    const { getPref, setPref } = await import("@/lib/prefs");
    const { settingValue, MAX_SETTINGS } = await import("../view-settings");
    const d = { name: String(name).slice(0, 60), label: "", type: (["text", "number", "toggle", "select"].includes(decl?.type) ? decl.type : "text") as "text", options: (decl?.options ?? []).map(String).slice(0, 100), default: "" };
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(d.name)) throw new Error("A setting's name is letters, digits and _.");
    const v = settingValue(d, value);
    if (v === null) throw new Error("That value does not fit the setting.");
    const all = { ...(getPref<Record<string, string>>(key(Number(db)), {}) ?? {}) };
    if (!(d.name in all) && Object.keys(all).length >= MAX_SETTINGS) throw new Error("Too many settings.");
    all[d.name] = v;
    setPref(key(Number(db)), all);
    return { values: all };
  });
}
