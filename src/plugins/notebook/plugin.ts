import { definePlugin } from "../define";

/** Notebook: code blocks in pages that run (Python, Node.js, Rust), .znb / .ipynb files (its manifest). */
export default definePlugin({
  id: "notebook",
  order: 134,
  name: "Notebook",
  description:
    "Code blocks in any page that you can run — Python, Node.js or Rust, the language chosen per block. A session per page and language keeps its variables from cell to cell; the outputs are text, errors, images, HTML and tables. A page can be saved as a .znb file (a Jupyter notebook with Zeff's blocks on top), opened in Jupyter as it is, and a Jupyter notebook (.ipynb) can be imported. Running code is switched off until you turn it on (Settings → Notebook).",
  category: "app",
  defaultInstalled: true,
  requires: "Python 3, and Rust (rustc) for Rust cells, on this computer. Node.js is Zeff's own.",
  dependsOn: ["workspace"],
  settings: { href: "/settings/notebook", what: "Switch code running on, the time limit, the languages found" },
  routes: ["/settings/notebook"],
});
