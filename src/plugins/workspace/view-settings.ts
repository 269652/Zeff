/**
 * Settings of an app made of views: <setting name="currency" label="Currency" type="select" options="EUR, USD" default="EUR"/> declares one
 * (a text, a number, a switch or a choice), <settings/> draws the form, `settings.currency` reads it anywhere in the view. Kept per database
 * in the account (the prefs). Pure parts here; the store is in actions/view-settings.ts. Client-safe.
 */
export type SettingDecl = { name: string; label: string; type: "text" | "number" | "toggle" | "select"; options: string[]; default: string };

export const MAX_SETTINGS = 40;
export const MAX_SETTING_VALUE = 2000;

/** A value as the setting takes it (text), or null when it does not fit. */
export function settingValue(d: SettingDecl, v: unknown): string | null {
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  if (s.length > MAX_SETTING_VALUE) return null;
  if (d.type === "number") return s === "" ? "" : Number.isFinite(Number(s.replace(",", "."))) ? String(Number(s.replace(",", "."))) : null;
  if (d.type === "toggle") return s === "true" ? "true" : "";
  if (d.type === "select") return s === "" || d.options.includes(s) ? s : null;
  return s;
}

/** What the view sees: the saved value, else the default. */
export function settingsWithDefaults(decls: SettingDecl[], saved: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(decls.map((d) => [d.name, saved && d.name in saved ? saved[d.name] : d.default]));
}
