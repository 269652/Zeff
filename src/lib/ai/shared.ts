/** The AI providers analyses (like the Todos tab's) can run through — client-safe. */
import { translator, type T as Translate } from "@/lib/i18n/shared";

const en = translator("en");

/** An AI provider's answer: the output (JSON as asked for), the model, what it cost, how long it took. */
/** The tokens an answer used (what the CLI reports; none: it does not say). */
export type AiUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type AiAnswer<T> = { output: T; model: string | null; costUsd: number | null; durationMs: number | null; usage?: AiUsage };

export const AI_PROVIDERS = ["claude", "copilot", "codex"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const isAiProvider = (v: unknown): v is AiProvider => (AI_PROVIDERS as readonly unknown[]).includes(v);

/** The providers' names, how they sign in and how to install them — in a language (client: `aiProviderInfo(useT())`). */
export const aiProviderInfo = (t: Translate): Record<AiProvider, { label: string; signIn: string; install: string }> => ({
  claude: {
    label: "Claude Code CLI",
    signIn: t("Signed in like Claude Code itself (your Claude login)."),
    install: t("npm install -g @anthropic-ai/claude-code — then start claude once and sign in."),
  },
  copilot: {
    label: "GitHub Copilot CLI",
    signIn: t("Signed in through copilot → /login (or a GH_TOKEN)."),
    install: t("npm install -g @github/copilot — then start copilot once and run /login."),
  },
  codex: {
    label: "ChatGPT (Codex CLI)",
    signIn: t("Signed in with your ChatGPT account (codex login)."),
    install: t("npm install -g @openai/codex — then run codex login once."),
  },
});
/** In English (the labels are names; use aiProviderInfo(t) for the texts). */
export const AI_PROVIDER_INFO = aiProviderInfo(en);

/** Claude's model aliases ("" = the CLI's own), labelled in a language (client: `claudeModels(useT())`). */
export const claudeModels = (t: Translate) =>
  [
    { value: "", label: t("Default (the CLI's)") },
    { value: "opus", label: t("Opus — most thorough") },
    { value: "sonnet", label: t("Sonnet — quick (Boards ≈ 45 s)") },
    { value: "haiku", label: t("Haiku — too slow for Boards") },
  ] as const;
/** In English (or use claudeModels(t)). */
export const CLAUDE_MODELS = claudeModels(en);

/** Copilot model names to suggest (any the CLI knows works; "" = its own default). */
export const COPILOT_MODEL_SUGGESTIONS = ["claude-sonnet-4.5", "claude-haiku-4.5", "gpt-5.4"];

/** A Copilot model id as a name: "gpt-6-luna" → "GPT 6 Luna", "claude-opus-5.5" → "Claude Opus 5.5". */
export const copilotModelName = (id: string) =>
  id
    .split("-")
    .map((p) => (/^(gpt|mai)$/i.test(p) ? p.toUpperCase() : /^[a-z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");

/** The family a Copilot model belongs to — the dropdown's groups. */
export const copilotModelFamily = (id: string) => (/^claude-/.test(id) ? "Claude" : /^gpt-/.test(id) ? "GPT" : /^gemini-/.test(id) ? "Gemini" : "Other");

export const isClaudeModel = (v: string) => CLAUDE_MODELS.some((m) => m.value === v);
