import { definePlugin } from "../define";

/** Open loops: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "loops",
  order: 171,
  name: "Open loops",
  description:
    "What is still open between you and others, across all sources: what you promised (“I'll send it tomorrow”), what was promised to you (“can you by Friday …”), questions to you nobody answered yet, your questions still without an answer, Jira comments addressed to you, review and signature requests. The promises are read from your messages by the AI (with the People plugin's extraction, a quote each); the questions, mentions and requests by rule. A loop closes by itself where the source leaves no doubt (an attachment sent after a promise to send, the ticket done, a question answered); a reply about it, or the AI's reading with a quote, is proposed for you to confirm; or you close it. The Open loops page (yours / owed to you / overdue), the loops on a person's page, overdue ones as a gentle nudge on the Today page; agents ask it too (MCP: open_loops).",
  category: "app",
  defaultInstalled: false,
  dependsOn: ["people"],
  apps: [{ href: "/loops", label: "Open loops", short: "Loops", hint: "What you owe, what you are owed" }],
  routes: ["/loops"],
});
