import { definePlugin } from "../define";

/** Documents: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "documents",
  order: 190,
  name: "Documents",
  description: "A store for your documents: drop text files, Office files, PDFs, pictures or audio — Zeff reads the text out of them (pictures and scanned PDFs through the Claude CLI; audio through a transcriber you set, e.g. Whisper) and, with the Knowledge plugin, the knowledge server compiles them: an abstract on hover, searchable, context for your todos. Attach a document to a todo by hand to give it as context.",
  category: "app",
  defaultInstalled: false,
  requires: "For pictures and scanned PDFs: the Claude CLI (scanned PDFs also Poppler's pdftoppm). For audio: a transcriber command.",
  settings: { href: "/documents#settings", what: "The audio transcriber" },
  apps: [
    { href: "/documents", label: "Documents", short: "Docs", hint: "Drop documents, images, audio" },
  ],
  routes: ["/documents", "/api/documents"],
  extensions: [
    { key: "doc-review", for: "todos", name: "Document review", description: "A step after every briefing: the AI reads new and changed documents and makes todos of what they ask of you — a deadline, a bill, a form, an open question — with the document as the source.", requires: ["llm"], defaultInstalled: true, syncSteps: ["doctodos"] },
    { key: "doc-relations", for: "todos", name: "Document matching", description: "A step after every briefing: the AI attaches to each open todo the documents it is about — by content. They then show on the todo, in its context and in the agents'.", requires: ["llm"], defaultInstalled: true, syncSteps: ["docrelations"] },
  ],
});
