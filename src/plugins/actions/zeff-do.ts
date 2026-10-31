/**
 * "Do in Zeff": the one generic action. Any plugin can offer an API method to the AI (an `offer` on the method,
 * see lib/plugins/api-kit.ts) — a branch naming rule, a Kanban card, a setting, whatever Zeff can do — and the AI
 * proposes it from an instruction in a chat, a mail or a ticket as an action on the todo; one click runs the method.
 * The op carries the method, what the AI wrote (`args`) and its own title and text, so it reads the same anywhere;
 * the checking against what is offered happens on the server (`zeffDoCheck`, set by actions/server.ts). Client-safe.
 */
import { action, EN, str } from "./types";

/** The operation types this plugin brings (an entry per `type`); the core's TodoOp is the union of all plugins'. */
declare module "@/lib/todos/shared" {
  interface TodoOpMap {
    /** An API method of a plugin, offered to the AI: its name, what the AI wrote for its fields, and how it reads (title, text). */
    "zeff-do": { method: string; args: Record<string, string>; title: string; body: string };
  }
}

/** What the server says of an AI's proposal: its cleaned fields and how it reads — null: not offered, or incomplete. Set on the server. */
export type ZeffDoCheck = (method: string, raw: Record<string, string>) => { args: Record<string, string>; title: string; body: string } | null;
let zeffDoCheck: ZeffDoCheck = () => null;
export const setZeffDoCheck = (fn: ZeffDoCheck) => {
  zeffDoCheck = fn;
};

/** What the AI wrote for the fields: an object, or JSON text of one; every value as text. */
function argsOf(v: unknown): Record<string, string> {
  let o: unknown = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, x]) => [k, str(x)]));
}

export const ZEFF_ACTIONS = [
  action({
    type: "zeff-do",
    plugin: null,
    label: "Do in Zeff",
    verb: "Do",
    offer: {
      when: "Eine Anweisung, Regel oder Absprache, wie in Zeff selbst etwas gehandhabt werden soll (z. B. wie Branches benannt werden, eine Karte auf einem Board) — in einem Chat, einer Mail, einem Ticket. NUR mit einer der Methoden unten (method genau so); Zeff führt sie mit einem Klick aus. Nichts für Dinge, die eine der anderen Aktionen schon kann.",
      fields: {
        method: "der Name einer der Methoden unten, genau so geschrieben",
        args: "ein JSON-Objekt (als Text) mit den Feldern der Methode, wie in ihrem Beispiel",
      },
      example: { type: "zeff-do", method: "<Methode>", args: '{"feld": "wert"}' },
    },
    clean: (o) => {
      const method = str(o.method);
      // One already kept on a todo (it has its title): as it is — whether its method is still offered is decided when it runs, so reading a todo never drops it.
      if (method && str(o.title)) return { type: "zeff-do", method, args: argsOf(o.args), title: str(o.title).slice(0, 200), body: str(o.body).slice(0, 2000) };
      const checked = method ? zeffDoCheck(method, argsOf(o.args)) : null;
      return checked ? { type: "zeff-do", method, args: checked.args, title: checked.title.slice(0, 200), body: checked.body.slice(0, 2000) } : null;
    },
    title: (op) => op.title,
    note: (op, t = EN) => ({ heading: op.title, detail: t("In Zeff: {method}", { method: op.method }), body: op.body || null }),
  }),
];
