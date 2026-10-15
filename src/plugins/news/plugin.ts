import { definePlugin } from "../define";

/** News: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "news",
  order: 180,
  name: "News",
  description: "Your news, gathered for you: the feeds you pick (Tagesschau, heise, Hacker News … or any RSS/Atom address) plus a search per interest. Everything is scored for you — your interests and how much each counts, words you mute, the sources you trust, how fresh it is, what you liked and disliked before and — if you want — what your open todos are about. Read, save, hide, like or dislike; with the LLM plugin an overview of the day. Public feeds only: nothing of yours is sent.",
  category: "app",
  defaultInstalled: false,
  settings: { href: "/settings/news", what: "Sources, interests, muted words, how it learns" },
  apps: [
    { href: "/news", label: "News", short: "News", hint: "Your news, scored for you" },
  ],
  routes: ["/news", "/settings/news"],
  syncSteps: ["news"],
});
