import { ApiError, int, str, type ApiContribution } from "@/lib/plugins/api-kit";
import { t } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { PRIORITIES, type CardView } from "./shared";
import * as store from "./store";

/** Kanban's part of the plugin API (docs/plugins/api.md): your boards and cards. */

const card = (c: CardView) => ({ id: c.id, ref: c.ref, columnId: c.columnId, title: c.title, description: c.description, labels: c.labels, priority: c.priority, due: c.due, assignee: c.assignee, parentId: c.parentId, doneAt: c.doneAt });

/** Store errors (a card that isn't there, a bad date) as API errors. */
const guard = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw new ApiError("failed", errorMessage(e));
  }
};

export const KANBAN_API: ApiContribution = {
  events: { "kanban.changed": { description: "Something on your Kanban boards changed (no details; at most every half second)", topic: "kanban" } },
  permissions: () => ({
    "kanban.read": t("Read your Kanban boards and cards"),
    "kanban.write": t("Add, change, move and archive Kanban cards"),
  }),
  methods: {
    "kanban.boards.list": {
      perm: "kanban.read",
      summary: "Your boards with their card counts.",
      run: () => store.listBoards().map((b) => ({ id: b.id, name: b.name, description: b.description, cards: b.cards, open: b.open, inLage: b.inLage })),
    },
    "kanban.boards.get": {
      perm: "kanban.read",
      summary: "A board with its columns and cards.",
      run: (p) => {
        const b = guard(() => store.getBoard(int(p, "id", { required: true, min: 1 })!));
        return { id: b.id, name: b.name, description: b.description, columns: b.columns.map((c) => ({ id: c.id, name: c.name, done: c.done, wipLimit: c.wipLimit, cards: c.cards.map(card) })) };
      },
    },
    "kanban.cards.add": {
      perm: "kanban.write",
      summary: "A card at the end of a column (columnId, title; optional description, labels, priority, due, assignee).",
      offer: {
        label: "Kanban card",
        when: "Etwas, das als Aufgabe auf eines meiner Kanban-Boards gehört (kein Jira-Ticket, keine Nachricht): eine Karte mit Titel und kurzer Beschreibung. Board und Spalte als Namen; ohne Angabe das erste Board / die erste Spalte.",
        fields: { board: "der Name des Boards (siehe „Bestehendes in Zeff“)", column: "der Name der Spalte — ohne Angabe die erste", title: "der Titel der Karte (kurz)", description: "kurze Beschreibung, optional" },
        example: { board: "Privat", column: "Open", title: "Geschenk für Nadine besorgen", description: "Geburtstag am 16.10." },
        check: (raw) => {
          const title = (raw.title ?? "").trim().slice(0, 300);
          if (!title) return null;
          const boards = store.listBoards();
          const want = (raw.board ?? "").trim().toLowerCase();
          const b = (want && (boards.find((x) => x.name.toLowerCase() === want) ?? boards.find((x) => x.name.toLowerCase().includes(want)))) || boards[0];
          if (!b) return null;
          const cols = store.getBoard(b.id).columns;
          const wantCol = (raw.column ?? "").trim().toLowerCase();
          const col = (wantCol && (cols.find((c) => c.name.toLowerCase() === wantCol) ?? cols.find((c) => c.name.toLowerCase().includes(wantCol)))) || cols[0];
          return col ? { columnId: col.id, title, description: (raw.description ?? "").trim().slice(0, 2000), board: b.name, column: col.name } : null;
        },
        describe: (p) => ({ title: t("Kanban card “{title}” on {board}", { title: String(p.title), board: String(p.board) }), body: [String(p.column), String(p.description ?? "")].filter(Boolean).join(" — ") }),
        context: () =>
          store.listBoards().map((b) => `Board „${b.name}“ — Spalten: ${store.getBoard(b.id).columns.map((c) => c.name).join(", ")}`),
      },
      run: (p) =>
        guard(() => {
          const c = store.createCard(int(p, "columnId", { required: true, min: 1 })!, str(p, "title", { required: true, max: 300 }));
          const patch = cardPatch(p);
          return card(Object.keys(patch).length ? store.updateCard(c.id, patch) : c);
        }),
    },
    "kanban.cards.update": {
      perm: "kanban.write",
      summary: "Change a card (id; title, description, labels, priority, due, assignee).",
      run: (p) => guard(() => card(store.updateCard(int(p, "id", { required: true, min: 1 })!, cardPatch(p)))),
    },
    "kanban.cards.move": {
      perm: "kanban.write",
      summary: "Move a card into a column, before another card (`before`; none: at the end).",
      run: (p) =>
        guard(() => {
          store.moveCard(int(p, "id", { required: true, min: 1 })!, int(p, "columnId", { required: true, min: 1 })!, int(p, "before", { min: 1 }) ?? null);
          return true;
        }),
    },
    "kanban.cards.archive": { perm: "kanban.write", summary: "Archive a card.", run: (p) => guard(() => (store.archiveCard(int(p, "id", { required: true, min: 1 })!), true)) },
    "kanban.cards.unarchive": { perm: "kanban.write", summary: "Bring an archived card back.", run: (p) => guard(() => (store.unarchiveCard(int(p, "id", { required: true, min: 1 })!), true)) },
  },
};

/** The fields of a card a caller may set (those present). */
function cardPatch(p: Record<string, unknown>) {
  const out: Parameters<typeof store.updateCard>[1] = {};
  if ("title" in p && p.title !== undefined) out.title = str(p, "title", { required: true, max: 300 });
  if ("description" in p) out.description = str(p, "description");
  if ("labels" in p) {
    if (!Array.isArray(p.labels) || p.labels.some((l) => typeof l !== "string")) throw new ApiError("bad_request", "labels: a list of texts");
    out.labels = p.labels as string[];
  }
  if ("priority" in p) {
    if (p.priority !== null && !(PRIORITIES as readonly unknown[]).includes(p.priority)) throw new ApiError("bad_request", `priority: ${PRIORITIES.join(", ")} or null`);
    out.priority = p.priority as (typeof PRIORITIES)[number] | null;
  }
  if ("due" in p) out.due = p.due === null ? null : str(p, "due", { max: 10 });
  if ("assignee" in p) out.assignee = p.assignee === null ? null : str(p, "assignee", { max: 80 });
  return out;
}
