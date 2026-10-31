/**
 * The Work plugin's actions: handing a todo to a worker with an instruction, and the delivery
 * steps Zeff makes after an implementation (commit, push, merge into main). Client-safe.
 */
import { action, EN, str } from "../actions/types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/todos/shared" {
  interface TodoOpMap {
  /** The todo handed to a worker (Code tab) with this instruction. */
  "work-instruct": { instruction: string };
  // Delivery (Zeff makes these after an implementation; not in the AI's dictionary):
  "git-push": { repo: string; branch: string; remote: string; target: string; title?: string; description?: string };
  "git-merge-main": { repo: string; branch: string; target: string };
  /** Uncommitted changes (these files) committed on a feature branch (made from where the checkout is, when it's another). */
  "git-commit-branch": { repo: string; branch: string; files: string[]; message: string; target: string };
  }
}

export const WORK_ACTIONS = [
  action({
    type: "work-instruct",
    plugin: "work",
    label: "Hand to Copilot",
    verb: "To Copilot",
    offer: {
      when: "Etwas, das ein KI-Worker im Repo oder mit den Daten selbst erledigen kann: etwas umsetzen oder fixen (auf einem Feature-Branch, danach testest du), etwas im Code nachsehen und berichten, einen Text, eine Antwort oder ein Konzept ausarbeiten. Die Anweisung ist konkret und vollständig — was genau, wo, woran man erkennt, dass es fertig ist.",
      fields: { instruction: "die fertige Anweisung an den Worker (Du-Form, konkret, mit Ticket-Key, 1–5 Sätze)" },
      example: {
        type: "work-instruct",
        instruction: "Prüf in PROJ-415, ob die VideoHub-Migration Videos ohne Poster-Bild überspringt, und berichte, welche Datensätze betroffen sind — nichts ändern.",
      },
    },
    clean: (o) => (str(o.instruction) ? { type: "work-instruct", instruction: str(o.instruction).slice(0, 4000) } : null),
    title: (op, t = EN) => t("To Copilot: {instruction}", { instruction: `${op.instruction.slice(0, 60)}${op.instruction.length > 60 ? "…" : ""}` }),
    note: (op, t = EN) => ({ heading: t("Hand to Copilot (Code tab)"), detail: null, body: op.instruction }),
  }),
  action({
    type: "git-push",
    plugin: "work",
    label: "Push branch",
    verb: "Push",
    delivery: true,
    clean: (o) =>
      str(o.repo) && str(o.branch) && str(o.remote)
        ? { type: "git-push", repo: str(o.repo), branch: str(o.branch), remote: str(o.remote), target: str(o.target) || "main", title: str(o.title) || undefined, description: str(o.description) || undefined }
        : null,
    title: (op, t = EN) => t("Push {branch} as {remote}", { branch: op.branch, remote: op.remote }),
    note: (op, t = EN) => ({ heading: t("Push branch"), detail: `${op.branch} → origin/${op.remote}`, body: null }),
  }),
  action({
    type: "git-merge-main",
    plugin: "work",
    label: "Merge into the main branch",
    verb: "Merge",
    delivery: true,
    clean: (o) => (str(o.repo) && str(o.branch) ? { type: "git-merge-main", repo: str(o.repo), branch: str(o.branch), target: str(o.target) || "main" } : null),
    title: (op, t = EN) => t("Merge {branch} into {target} and push", { branch: op.branch, target: op.target }),
    note: (op, t = EN) => ({
      heading: t("Merge into {target}", { target: op.target }),
      detail: t("{branch} → {target}, then push", { branch: op.branch.replace(/^origin\//, ""), target: op.target }),
      body: null,
    }),
  }),
  action({
    type: "git-commit-branch",
    plugin: "work",
    label: "Commit changes",
    verb: "Commit",
    delivery: true,
    clean: (o) =>
      str(o.repo) && str(o.branch) && Array.isArray(o.files) && o.files.length
        ? { type: "git-commit-branch", repo: str(o.repo), branch: str(o.branch), files: o.files.map(str).filter(Boolean).slice(0, 500), message: str(o.message) || str(o.branch), target: str(o.target) || "main" }
        : null,
    title: (op, t = EN) => (op.files.length === 1 ? t("Commit 1 file on {branch}", { branch: op.branch }) : t("Commit {n} files on {branch}", { n: op.files.length, branch: op.branch })),
    note: (op, t = EN) => ({
      heading: op.files.length === 1 ? t("Commit 1 file") : t("Commit {n} files", { n: op.files.length }),
      detail: t("on {branch}: “{message}”", { branch: op.branch, message: op.message }),
      body: null,
      files: op.files,
    }),
  }),
];
