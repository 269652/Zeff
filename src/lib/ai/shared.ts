/** The AI providers analyses (like the Todos tab's) can run through — client-safe. */

/** An AI provider's answer: the output (JSON as asked for), the model, what it cost, how long it took. */
export type AiAnswer<T> = { output: T; model: string | null; costUsd: number | null; durationMs: number | null };

export const AI_PROVIDERS = ["claude", "copilot"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const isAiProvider = (v: unknown): v is AiProvider => (AI_PROVIDERS as readonly unknown[]).includes(v);

export const AI_PROVIDER_INFO: Record<AiProvider, { label: string; signIn: string; install: string }> = {
  claude: {
    label: "Claude Code CLI",
    signIn: "Signed in like Claude Code itself (your Claude login).",
    install: "npm install -g @anthropic-ai/claude-code — then start claude once and sign in.",
  },
  copilot: {
    label: "GitHub Copilot CLI",
    signIn: "Signed in through copilot → /login (or a GH_TOKEN).",
    install: "npm install -g @github/copilot — then start copilot once and run /login.",
  },
};

/** Claude's model aliases ("" = the CLI's own). */
export const CLAUDE_MODELS = [
  { value: "", label: "Default (the CLI's)" },
  { value: "opus", label: "Opus — most thorough" },
  { value: "sonnet", label: "Sonnet — quick (Boards ≈ 45 s)" },
  { value: "haiku", label: "Haiku — too slow for Boards" },
] as const;

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
