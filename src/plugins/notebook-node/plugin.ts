import { definePlugin } from "../define";

/** Notebook · Node.js: JavaScript code blocks that run (its manifest). */
export default definePlugin({
  id: "notebook-node",
  order: 136,
  name: "Notebook · Node.js",
  description:
    "Node.js for the Notebook: code blocks in pages run JavaScript in a session that keeps its variables — top-level await, require(), fetch, console output and display.html() / display.png() for rich output. By default in a Docker container (the image node:22-slim); with Zeff's own Node.js when Docker is not there or you choose so.",
  category: "app",
  defaultInstalled: true,
  requires: "Docker (the default); Zeff's own Node.js otherwise.",
  dependsOn: ["notebook"],
});
