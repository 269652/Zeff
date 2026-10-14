import { definePlugin } from "../define";

/** Knowledge: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "knowledge",
  order: 160,
  name: "Knowledge",
  description: "Knowledge from Confluence: the knowledge server (knowledge/, a server of its own) compiles the pages with Copilot into a searchable knowledge graph. Here you ask it in a chat; on todos the “Knowledge” toggle shows the matching pages, and agents search it (MCP).",
  category: "app",
  defaultInstalled: false,
  requires: "the knowledge server — the launcher (Zeff.exe) starts it; every further account with this plugin gets its own, with its own database",
  tabs: [
    { href: "/knowledge", label: "Chat", short: "Chat" },
  ],
  routes: ["/knowledge", "/graph"],
  extensions: [
    { key: "todo-knowledge", for: "todos", name: "Knowledge matching", description: "A step after every briefing: for each new or changed todo the AI checks the knowledge base's hits and keeps only what really fits — the “Knowledge” toggle then shows exactly that.", requires: ["llm"], defaultInstalled: true, syncSteps: ["knowledgerel"] },
  ],
});
