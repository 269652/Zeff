import { definePlugin } from "../define";

/** GitHub Copilot CLI: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "copilot-cli",
  order: 230,
  name: "GitHub Copilot CLI",
  description: "Copilot as the AI for the briefing, the mail steps and the workers — interactive too (ACP): permissions, questions and mode on the Work tab.",
  category: "ai",
  defaultInstalled: true,
  requires: "The Copilot CLI (npm install -g @github/copilot), signed in once (copilot → /login).",
  dependsOn: ["llm"],
  aiProvider: "copilot",
});
