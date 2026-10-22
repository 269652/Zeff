import { definePlugin } from "../define";

/** Structured questions: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "questions",
  order: 165,
  name: "Structured questions",
  description:
    "Questions about numbers and dates answered from your own data: “How much did I spend on craftsmen in 2026?”, “When did I last talk to Anna?”, “Which tickets cost me the most time?”. The AI picks a query over named, read-only views (time entries, bank transactions, calendar, todos, messages, Workspace databases), Zeff runs it and the AI answers with the numbers, the rows linked and the query shown. In the knowledge chat (questions about text still go to the knowledge) and for agents (MCP ask_structured).",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["llm"],
});
