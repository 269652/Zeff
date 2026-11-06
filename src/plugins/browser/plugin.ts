import { definePlugin } from "../define";

/** Browser: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "browser",
  order: 126,
  name: "Browser",
  description:
    "Lets Zeff's AI open public web pages in an automated Chrome of its own — pages that only load with JavaScript too: it reads their text, links and pictures, and can click and type on them. As an MCP tool for agents and in the Workspace chat. No key needed.",
  category: "connector",
  defaultInstalled: false,
  beta: "It browses for you with Chrome's normal User-Agent, but a page can still refuse it or ask for a human check (IMDb does); Zeff doesn't get round that. The AI acts on its own on public websites: it can click and fill in forms there, though it has none of your logins. Pages on your computer or your own network stay out of reach.",
  requires: "Chrome or Edge installed on this computer.",
});
