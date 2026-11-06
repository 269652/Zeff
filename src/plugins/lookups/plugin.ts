import { definePlugin } from "../define";

/** Lookups: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "lookups",
  order: 127,
  name: "Lookups",
  description:
    "Search fields for your own Workspace views: type a title, pick a suggestion, and its data becomes a row — films and series (TMDB), books (Open Library, Google Books), Wikipedia articles, Google's Knowledge Graph and web results. What you type there goes to that service. Their pictures stay linked, not copied.",
  category: "connector",
  defaultInstalled: true,
  dependsOn: ["workspace"],
  requires: "Wikipedia and Open Library work as they are. TMDB needs your own free API key; Google Books and the Knowledge Graph a Google API key.",
  settings: { href: "/settings/lookups", what: "The API keys of the sources" },
  routes: ["/settings/lookups"],
});
