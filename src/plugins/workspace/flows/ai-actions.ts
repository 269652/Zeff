import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's actions for the local AI (docs/zeff-kernel.md, "The line": the local AI is a driver — lib/ai/local): its settings read and
 * saved, what answers at an address (and its models), a short test. What its settings page did through code of its own, a port's page
 * does through these (<data do>, <button do>). Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export const AI_ACTIONS: FlowAction[] = [
  {
    name: "localai.config",
    group: "ai",
    label: "The local AI's settings",
    summary: "Where the local AI's server answers, which model, whether what is marked secret goes to it (whole) instead of being left out.",
    input: [],
    output: "{ url, model, secretLocal, presets: [{ label, url }] }",
    run: async () => {
      const { localAiConfig, LM_STUDIO_URL, OLLAMA_URL } = await import("@/lib/ai/local/config");
      return { ...localAiConfig(), presets: [{ label: "Ollama", url: OLLAMA_URL }, { label: "LM Studio", url: LM_STUDIO_URL }] };
    },
  },
  {
    name: "localai.probe",
    group: "ai",
    label: "What answers at an address",
    summary: "Asks the address: Ollama (its own API) or an OpenAI-compatible server, and its models — or why nothing answers.",
    input: [f("url", "text", { required: true }), f("model", "text", { help: "The model chosen now: the choices name it when the server hasn't it" })],
    output: "{ ok, kind (ollama | openai), models, choices: [[value, label]] (\"\": the first one; the chosen one when not on the server), error }",
    run: async (i) => {
      const url = text(i.url).trim();
      const model = text(i.model).trim();
      const { probeLocalServer } = await import("@/lib/ai/local/client");
      const { t } = await import("@/lib/i18n/server");
      try {
        const s = await probeLocalServer(url);
        const choices = [["", t("The first one ({model})", { model: s.models[0] ?? "" })], ...(model && !s.models.includes(model) ? [[model, t("{model} (not on the server)", { model })]] : []), ...s.models.map((m) => [m, m])];
        return { ok: true, kind: s.kind, models: s.models, choices, error: null };
      } catch {
        return { ok: false, kind: null, models: [], choices: [], error: t("Nothing answers at {url} — is Ollama or LM Studio running?", { url }) };
      }
    },
  },
  {
    name: "localai.test",
    group: "ai",
    label: "Test the local AI",
    summary: "A short question to the model at the address: whether it answers as asked, and how long it took.",
    input: [f("url", "text", { required: true }), f("model", "text")],
    output: "{ what } — the answer in words (failing: an error)",
    run: async (i) => {
      const { runLocal } = await import("@/lib/ai/local/client");
      const { localAiConfig } = await import("@/lib/ai/local/config");
      const { t } = await import("@/lib/i18n/server");
      const t0 = Date.now();
      const r = await runLocal<{ ok: boolean }>("Antworte mit ok = true.", { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }, {
        model: text(i.model) || undefined,
        timeoutMs: 180000,
        config: { ...localAiConfig(), url: text(i.url), model: text(i.model) },
      });
      if (r.output?.ok !== true) throw new Error(t("It answered, but not as asked."));
      return { what: `${t("Works: answered in {s} s", { s: Math.round((Date.now() - t0) / 1000) })} · ${r.model}.` };
    },
  },
  {
    name: "localai.save",
    group: "ai",
    label: "Save the local AI's settings",
    summary: "The local AI's address (only http/https), its model, whether what is marked secret goes to it.",
    input: [f("url", "text", { required: true }), f("model", "text"), f("secretLocal", "boolean")],
    output: "{ what, url, model, secretLocal }",
    writes: true,
    run: async (i) => {
      const { saveLocalAiConfig } = await import("@/lib/ai/local/config");
      const { t } = await import("@/lib/i18n/server");
      const saved = saveLocalAiConfig({ url: text(i.url), model: text(i.model), secretLocal: i.secretLocal === true || i.secretLocal === "true" });
      return { what: t("Saved."), ...saved };
    },
  },
];

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:ai", AI_ACTIONS);
