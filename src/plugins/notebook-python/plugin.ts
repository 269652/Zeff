import { definePlugin } from "../define";

/** Notebook · Python: Python code blocks that run (its manifest). */
export default definePlugin({
  id: "notebook-python",
  order: 135,
  name: "Notebook · Python",
  description:
    "Python for the Notebook: code blocks in pages run Python in a session that keeps its variables, with plots (matplotlib), HTML and tables (pandas) as output, ! shell lines and %pip install. By default in a Docker container (the image python:3.12-slim); on this computer's Python when Docker is not there or you choose so.",
  category: "app",
  defaultInstalled: true,
  requires: "Docker (the default), or Python 3 on this computer.",
  dependsOn: ["notebook"],
});
