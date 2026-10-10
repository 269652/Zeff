/**
 * The Work plugin's actions: handing a todo to a worker with an instruction, and the delivery
 * steps Zeff makes after an implementation (commit, push, merge into main). Client-safe.
 */
import { action, str } from "../actions/types";

export const WORK_ACTIONS = [
  action({
    type: "work-instruct",
    plugin: "work",
    label: "An Copilot übergeben",
    verb: "An Copilot",
    offer: {
      when: "Etwas, das ein KI-Worker im Repo oder mit den Daten selbst erledigen kann: etwas umsetzen oder fixen (auf einem Feature-Branch, danach testest du), etwas im Code nachsehen und berichten, einen Text, eine Antwort oder ein Konzept ausarbeiten. Die Anweisung ist konkret und vollständig — was genau, wo, woran man erkennt, dass es fertig ist.",
      fields: { instruction: "die fertige Anweisung an den Worker (Du-Form, konkret, mit Ticket-Key, 1–5 Sätze)" },
      example: {
        type: "work-instruct",
        instruction: "Prüf in PROJ-415, ob die VideoHub-Migration Videos ohne Poster-Bild überspringt, und berichte, welche Datensätze betroffen sind — nichts ändern.",
      },
    },
    clean: (o) => (str(o.instruction) ? { type: "work-instruct", instruction: str(o.instruction).slice(0, 4000) } : null),
    title: (op) => `An Copilot: ${op.instruction.slice(0, 60)}${op.instruction.length > 60 ? "…" : ""}`,
    note: (op) => ({ heading: "An Copilot übergeben (Work-Tab)", detail: null, body: op.instruction }),
  }),
  action({
    type: "git-push",
    plugin: "work",
    label: "Branch pushen",
    verb: "Push",
    delivery: true,
    clean: (o) =>
      str(o.repo) && str(o.branch) && str(o.remote)
        ? { type: "git-push", repo: str(o.repo), branch: str(o.branch), remote: str(o.remote), target: str(o.target) || "main", title: str(o.title) || undefined, description: str(o.description) || undefined }
        : null,
    title: (op) => `${op.branch} pushen als ${op.remote}`,
    note: (op) => ({ heading: "Branch pushen", detail: `${op.branch} → origin/${op.remote}`, body: null }),
  }),
  action({
    type: "git-merge-main",
    plugin: "work",
    label: "In den Hauptzweig mergen",
    verb: "Merge",
    delivery: true,
    clean: (o) => (str(o.repo) && str(o.branch) ? { type: "git-merge-main", repo: str(o.repo), branch: str(o.branch), target: str(o.target) || "main" } : null),
    title: (op) => `${op.branch} in ${op.target} mergen und pushen`,
    note: (op) => ({ heading: `In ${op.target} mergen`, detail: `${op.branch.replace(/^origin\//, "")} → ${op.target}, dann pushen`, body: null }),
  }),
  action({
    type: "git-commit-branch",
    plugin: "work",
    label: "Änderungen committen",
    verb: "Commit",
    delivery: true,
    clean: (o) =>
      str(o.repo) && str(o.branch) && Array.isArray(o.files) && o.files.length
        ? { type: "git-commit-branch", repo: str(o.repo), branch: str(o.branch), files: o.files.map(str).filter(Boolean).slice(0, 500), message: str(o.message) || str(o.branch), target: str(o.target) || "main" }
        : null,
    title: (op) => `${op.files.length} Datei${op.files.length === 1 ? "" : "en"} auf ${op.branch} committen`,
    note: (op) => ({ heading: `${op.files.length} Datei${op.files.length === 1 ? "" : "en"} committen`, detail: `auf ${op.branch}: „${op.message}“`, body: null, files: op.files }),
  }),
];
