import { definePlugin } from "../define";

/** Claude CLI: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "claude-cli",
  order: 240,
  name: "Claude CLI",
  description: "Claude Code as the AI for the briefing and the workers — with model choice, permission mode and sending to Jira.",
  category: "ai",
  defaultInstalled: false,
  requires: "The Claude CLI (claude), signed in.",
  dependsOn: ["llm"],
  aiProvider: "claude",
});
