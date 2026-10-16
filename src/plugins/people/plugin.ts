import { definePlugin } from "../define";

/** People: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "people",
  order: 170,
  name: "People",
  description: "A profile for everyone who matters to you: your notes, their dates (birthday, anniversaries, whatever you want to remember) with a reminder — on the Today page and as a desktop notification — plus what Zeff knows about them: the knowledge (with the Knowledge plugin), their latest messages (WhatsApp, mail), the todos they appear in. Zeff finds dates in your facts and — with the LLM plugin — the AI finds them in knowledge and messages; you confirm them.",
  category: "app",
  defaultInstalled: false,
  routes: ["/personen"],
  syncSteps: ["peoplenorm"],
});
