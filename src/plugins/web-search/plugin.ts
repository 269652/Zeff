import { definePlugin } from "../define";

/** Web search: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "web-search",
  order: 125,
  name: "Web search",
  description:
    "Lets Zeff's AI search the web and read a page — as MCP tools for agents and as tools of the Workspace chat: it can look up prices, token limits or documentation and fill a database with them. The search runs through your Claude login, without a key or card, or through an official API if you add a key (Brave, Google Programmable Search); never by scraping. Pages are only read from the public internet, never from your own network.",
  category: "connector",
  defaultInstalled: false,
  requires: "The Claude CLI, signed in. Optional and quicker: a Brave Search API key (Brave asks for a card), or Google Programmable Search if you already have it.",
  settings: { href: "/settings/web-search", what: "The provider and its API key" },
  routes: ["/settings/web-search"],
});
