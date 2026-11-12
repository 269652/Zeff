/**
 * The secret that lets a program outside Zeff call a plugin's webhook functions (manifest `webhook: true`): one per plugin, made by the
 * user in Settings → Notebook, stored in the account (the prefs), compared in constant time. Without one, a webhook answers nobody.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getPref, setPref } from "@/lib/prefs";

const key = (plugin: string) => `notebook.hook.${plugin}`;

export const webhookSecret = (plugin: string): string => {
  const v = getPref<unknown>(key(plugin), "");
  return typeof v === "string" ? v : "";
};

/** A new secret (the old one stops working). */
export function renewWebhookSecret(plugin: string): string {
  const s = randomBytes(24).toString("hex");
  setPref(key(plugin), s);
  return s;
}

export function clearWebhookSecret(plugin: string): void {
  setPref(key(plugin), "");
}

export function webhookSecretMatches(plugin: string, given: string): boolean {
  const have = webhookSecret(plugin);
  if (!have || !given) return false;
  const a = Buffer.from(have);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
