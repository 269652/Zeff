import { definePlugin } from "../define";

/** Web search: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "web-search",
  order: 125,
  name: "Web search",
  description:
    "Lets Zeff's AI search the web (Google) and read a page — as MCP tools for agents and as tools of the Workspace chat: it can look up prices, token limits or documentation and fill a database with them. The search goes through an official API (Google Programmable Search, or Brave), never by scraping; pages are only read from the public internet, never from your own network. Off until you install it and add a key.",
  category: "connector",
  defaultInstalled: false,
  requires: "An API key: Google Programmable Search (an API key and a search engine id, free for 100 searches a day) or a Brave Search API key.",
  settings: { href: "/settings/web-search", what: "The provider and its API key" },
  routes: ["/settings/web-search"],
});
