import { definePlugin } from "../define";

/** What you should know: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "know",
  order: 176,
  name: "What you should know",
  description: "Context just in time: before an appointment with people, and beside a mail, a chat, a ticket, a person or a case, what Zeff knows that matters now — who they are (only facts that still hold), your last interactions with them, what is still open between you (promised by you or to you), the tickets, cases and projects it is about, money owed either way and a birthday coming up — each with a link to its source, and a line when a source it relies on hasn't synced. Put together by rule, at once; with the LLM plugin a short summary on top, written before your meetings (with the briefing) or when you ask, and kept until something changes. On the appointment, on Today about half an hour before, as a module of rows and pages, and for agents (MCP: meeting_brief, context_brief). Secret data never shows; agents see personal data only with permission.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["timeline"],
});
