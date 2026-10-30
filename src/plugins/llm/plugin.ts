import { definePlugin } from "../define";

/** LLM: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "llm",
  order: 220,
  name: "LLM",
  description: "The AI layer: all AI tasks (briefing, recap, mail steps, auto actions, workers) run through it — each with its own backend and model or the default, all with your instructions and your context. The backends are the CLI plugins.",
  category: "ai",
  defaultInstalled: true,
  settings: { href: "/settings/ai", what: "AI backend and model per task, instructions" },
  routes: ["/llm"],
});
