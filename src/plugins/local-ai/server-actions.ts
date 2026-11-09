"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** The local AI's settings saved: address, model, whether secret lines go to it. */
export async function saveLocalAiAction(v: { url: string; model: string; secretLocal: boolean }): Promise<ActionState> {
  try {
    const { saveLocalAiConfig } = await import("./config");
    saveLocalAiConfig({ url: String(v.url ?? ""), model: String(v.model ?? ""), secretLocal: !!v.secretLocal });
    revalidatePath("/settings/local-ai");
    revalidatePath("/settings/ai");
    return { ok: true, message: t("Saved.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** What answers at an address, and its models — or why nothing does. */
export async function probeLocalAiAction(url: string): Promise<{ ok: true; kind: "ollama" | "openai"; models: string[] } | { ok: false; error: string }> {
  try {
    const { probeLocalServer } = await import("./client");
    const s = await probeLocalServer(String(url ?? ""));
    return { ok: true, kind: s.kind, models: s.models };
  } catch {
    return { ok: false, error: t("Nothing answers at {url} — is Ollama or LM Studio running?", { url: String(url ?? "") }) };
  }
}

/** A short test: the model answers a question as JSON. Its time. */
export async function testLocalAiAction(v: { url: string; model: string }): Promise<ActionState> {
  try {
    const { runLocal } = await import("./client");
    const { localAiConfig } = await import("./config");
    const t0 = Date.now();
    const r = await runLocal<{ ok: boolean }>("Antworte mit ok = true.", { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }, {
      model: v.model || undefined,
      timeoutMs: 180000,
      config: { ...localAiConfig(), url: String(v.url ?? ""), model: String(v.model ?? "") },
    });
    if (r.output?.ok !== true) return { ok: false, error: t("It answered, but not as asked.") };
    return { ok: true, message: `${t("Works: answered in {s} s", { s: Math.round((Date.now() - t0) / 1000) })} · ${r.model}.` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
