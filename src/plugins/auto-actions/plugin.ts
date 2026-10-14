import { definePlugin } from "../define";

/** Auto actions: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "auto-actions",
  order: 100,
  name: "Auto actions",
  description: "An AI step of its own after the briefing: every open todo without a button gets ready-made actions from what the installed plugins can do — a message, a comment, a mail draft, a meeting in a free slot, a hand-over to a worker. One click and it's done.",
  category: "ai",
  defaultInstalled: true,
  dependsOn: ["todos", "llm"],
  syncSteps: ["autoactions"],
});
