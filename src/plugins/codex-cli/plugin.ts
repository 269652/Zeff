import { definePlugin } from "../define";

/** ChatGPT (Codex CLI): what it is and what it brings (its manifest). */
export default definePlugin({
  id: "codex-cli",
  order: 250,
  name: "ChatGPT (Codex CLI)",
  description: "ChatGPT as the AI for the briefing, the mail steps and the other AI tasks — through OpenAI's Codex CLI, signed in with your ChatGPT account.",
  category: "ai",
  defaultInstalled: false,
  requires: "The Codex CLI (npm install -g @openai/codex), signed in once (codex login).",
  dependsOn: ["llm"],
  aiProvider: "codex",
});
