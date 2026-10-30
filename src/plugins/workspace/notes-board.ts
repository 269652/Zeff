import { KEEP_COLORS } from "@/plugins/keep/colors";
import { COLOR_PROP, NOTE_PROP, PINNED_PROP } from "./collections";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property } from "./model";

/** A note board in the Workspace (what a moved Keep board is): a database like Google Keep's boards. */

/** Keep's colours as the Workspace's (those it has; teal and cerulean nearest). */
const WS_COLOR: Record<string, string> = { teal: "green", cerulean: "blue" };
const wsColor = (c: string) => WS_COLOR[c] ?? ((COLORS as readonly string[]).includes(c) ? c : "gray");
const option = (name: string, color: string): Option => ({ id: newId("o"), name, color });

/** The layout: colour, pinned, labels (the given ones as options) and the note ref; a gallery (pinned on top) and a table. */
export function notesBoardSchema(labelNames: string[] = []) {
  const color: Property = { id: COLOR_PROP, name: "Color", type: "select", options: Object.keys(KEEP_COLORS).map((c) => option(c, wsColor(c))) };
  const pinned: Property = { id: PINNED_PROP, name: "Pinned", type: "checkbox" };
  const labels: Property = { ...newProperty("Labels", "multi_select"), options: labelNames.map((n, i) => option(n, COLORS[(i + 3) % COLORS.length])) };
  const ref: Property = { id: NOTE_PROP, name: "Note", type: "text" };
  const schema: DbSchema = {
    titleName: "Title",
    properties: [color, pinned, labels, ref],
    views: [{ ...newView("Notes", "gallery"), sorts: [{ prop: pinned.id, dir: "desc" }], hidden: [ref.id, pinned.id] }, newView("Table", "table")],
  };
  return { schema, color, pinned, labels, ref };
}
