import { definePlugin } from "../define";

/**
 * Knowledge: what Zeff knows, three ways (its manifest) — context just in time ("What you should know"), questions
 * answered from your own data, and Confluence's pages as a knowledge graph. Each part on or off by itself, under the id
 * it had as a plugin of its own; their code stays in its folder (plugins/know, plugins/questions, plugins/knowledge).
 */
export default definePlugin({
  id: "knowledge-hub",
  order: 159,
  name: "Knowledge",
  description: "What Zeff knows, three ways: what you should know right now (before a meeting, beside a mail, a ticket or a person), questions about numbers and dates answered from your own data, and Confluence's pages as a searchable knowledge graph. Each part is switched on or off by itself.",
  category: "app",
  defaultInstalled: true,
  features: [
    {
      id: "know",
      order: 176,
      name: "What you should know",
      description: "Context just in time: before an appointment with people, and beside a mail, a chat, a ticket, a person or a case, what Zeff knows that matters now — who they are (only facts that still hold), your last interactions with them, what is still open between you (promised by you or to you), the tickets, cases and projects it is about, money owed either way and a birthday coming up — each with a link to its source, and a line when a source it relies on hasn't synced. Put together by rule, at once; with the LLM plugin a short summary on top, written before your meetings (with the briefing) or when you ask, and kept until something changes. On the appointment, on Today about half an hour before, as a module of rows and pages, and for agents (MCP: meeting_brief, context_brief). Secret data never shows; agents see personal data only with permission.",
      defaultInstalled: true,
      dependsOn: ["timeline"],
    },
    {
      id: "questions",
      order: 165,
      name: "Structured questions",
      description:
        "Questions about numbers and dates answered from your own data: “How much did I spend on craftsmen in 2026?”, “When did I last talk to Anna?”, “Which tickets cost me the most time?”. The AI picks a query over named, read-only views (time entries, bank transactions, calendar, todos, messages, Workspace databases), Zeff runs it and the AI answers with the numbers, the rows linked and the query shown. In the knowledge chat (questions about text still go to the knowledge) and for agents (MCP ask_structured).",
      defaultInstalled: true,
      dependsOn: ["llm"],
    },
    {
      id: "knowledge",
      order: 160,
      name: "Confluence knowledge",
      description: "Knowledge from Confluence: the knowledge server (knowledge/, a server of its own) compiles the pages with Copilot into a searchable knowledge graph. Here you ask it in a chat; on todos the “Knowledge” toggle shows the matching pages, and agents search it (MCP).",
      defaultInstalled: false,
      requires: "the knowledge server — the launcher (Zeff.exe) starts it; every further account with this plugin gets its own, with its own database",
      tabs: [{ href: "/knowledge", label: "Chat", short: "Chat" }],
      routes: ["/knowledge", "/graph"],
      extensions: [
        { key: "todo-knowledge", for: "todos", name: "Knowledge matching", description: "A step after every briefing: for each new or changed todo the AI checks the knowledge base's hits and keeps only what really fits — the “Knowledge” toggle then shows exactly that.", requires: ["llm"], defaultInstalled: true, syncSteps: ["knowledgerel"] },
      ],
    },
  ],
});
