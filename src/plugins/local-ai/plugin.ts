import { definePlugin } from "../define";

/** Local AI: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "local-ai",
  order: 257,
  name: "Local AI (Ollama, LM Studio)",
  description:
    "An AI that runs on this computer — Ollama, LM Studio, llama.cpp or any server with an OpenAI-compatible API: the briefing, the mail steps and the other AI tasks without a byte leaving it. As the default AI, for single tasks, or only for what you marked secret (it then reads that whole instead of it being left out).",
  category: "ai",
  defaultInstalled: false,
  requires: "Ollama (ollama.com) or LM Studio running on this computer, with a model pulled (e.g. ollama pull qwen3:8b).",
  dependsOn: ["llm"],
  aiProvider: "local",
  settings: { href: "/settings/local-ai", what: "Server address, model, what goes to it" },
  routes: ["/settings/local-ai"],
});
