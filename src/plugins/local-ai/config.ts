/**
 * The local AI's settings: where its server answers, which model, and whether what is marked secret goes to it (whole)
 * instead of being left out of the prompt. Kept as a preference of the account. Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

export type LocalAiConfig = {
  /** The server's address — Ollama's by default; LM Studio: http://127.0.0.1:1234. */
  url: string;
  /** The model ("qwen3:8b"; "" = the first the server has). */
  model: string;
  /** Prompts with secret lines go here, whole — never to a cloud AI. */
  secretLocal: boolean;
};

export const OLLAMA_URL = "http://127.0.0.1:11434";
export const LM_STUDIO_URL = "http://127.0.0.1:1234";
const KEY = "local-ai";
const DEFAULT: LocalAiConfig = { url: OLLAMA_URL, model: "", secretLocal: true };

export function localAiConfig(): LocalAiConfig {
  const v = getPref<Partial<LocalAiConfig>>(KEY, {});
  return {
    url: typeof v.url === "string" && v.url.trim() ? v.url.trim() : DEFAULT.url,
    model: typeof v.model === "string" ? v.model.trim() : DEFAULT.model,
    secretLocal: typeof v.secretLocal === "boolean" ? v.secretLocal : DEFAULT.secretLocal,
  };
}

/** Only a server on this computer (or one you name on your own network) — its address checked, nothing else. */
export function saveLocalAiConfig(patch: Partial<LocalAiConfig>): LocalAiConfig {
  const next = { ...localAiConfig(), ...patch };
  let u: URL;
  try {
    u = new URL(next.url);
  } catch {
    throw new ValidationError(t("Not an address: {url}", { url: next.url }));
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ValidationError(t("Not an address: {url}", { url: next.url }));
  next.url = `${u.protocol}//${u.host}`;
  next.model = next.model.slice(0, 120);
  setPref(KEY, next);
  return next;
}
