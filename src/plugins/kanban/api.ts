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
    "kanban.cards.restore": { perm: "kanban.write", summary: "Bring an archived card back.", run: (p) => guard(() => (store.restoreCard(int(p, "id", { required: true, min: 1 })!), true)) },
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
