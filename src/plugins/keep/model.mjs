/**
 * Keep's note content as it comes from its sync (notes/v1/changes): newer notes carry it as a list of
 * commands (serverChanges.snapshot.serializedChunks, else previewData.serializedCommands) —
 *   ["sct-add", i, sectionId, "txt" | "cbx"]                a section: text, or a checklist
 *   ["cbx-add", sectionId, itemId, [position]]               a checklist item
 *   ["cbx-p", sectionId, itemId, [], ["check", true]]        an item ticked (a property set)
 *   ["docs-nestedModel", ["text", i, sectionId, itemId?], { ibi, s, ty: "is" }]   text inserted
 * Replayed here into text and items; older notes have plain `text` and LIST_ITEM nodes instead.
 */

function commandsOf(node) {
  const chunks = node.serverChanges?.snapshot?.serializedChunks;
  const raw = chunks?.length ? chunks : node.previewData?.serializedCommands ? [node.previewData.serializedCommands] : [];
  const out = [];
  const walk = (list) => {
    for (const c of list) {
      if (!Array.isArray(c)) continue;
      if (c[0] === "docs-mlti" && Array.isArray(c[1])) walk(c[1]);
      else out.push(c);
    }
  };
  for (const r of raw) {
    try {
      walk(JSON.parse(r));
    } catch {
      // unreadable chunk: left out
    }
  }
  return out;
}

/** Insert `s` at 1-based index `ibi` (Keep's "is" operation). */
const insertAt = (text, ibi, s) => {
  const at = Math.max(0, Math.min(text.length, (Number(ibi) || 1) - 1));
  return text.slice(0, at) + s + text.slice(at);
};

/** A note's content: { text, items: [{ text, checked }] } — items only for a checklist. */
export function decodeModel(node) {
  const cmds = commandsOf(node);
  if (!cmds.length) return null;
  const sections = [];
  const items = new Map(); // itemId -> { pos, text, checked }
  let text = "";
  for (const c of cmds) {
    const [op] = c;
    if (op === "sct-add") sections.push({ id: c[2], type: c[3] });
    else if (op === "cbx-add") items.set(c[2], { pos: Array.isArray(c[3]) ? Number(c[3][0]) : items.size, text: "", checked: false });
    else if (op === "cbx-p") {
      const it = items.get(c[2]);
      const prop = Array.isArray(c[4]) ? c[4] : [];
      if (it && typeof prop[1] === "boolean") it.checked = prop[1];
    } else if (op === "docs-nestedModel") {
      const path = Array.isArray(c[1]) ? c[1] : [];
      const edit = c[2] || {};
      if (edit.ty !== "is" || typeof edit.s !== "string") continue;
      const itemId = path[3];
      if (itemId && items.has(itemId)) {
        const it = items.get(itemId);
        it.text = insertAt(it.text, edit.ibi, edit.s);
      } else text = insertAt(text, edit.ibi, edit.s);
    }
  }
  const list = sections.some((s) => s.type === "cbx") || items.size > 0;
  const ordered = [...items.values()].sort((a, b) => a.pos - b.pos).map((i) => ({ text: i.text, checked: i.checked }));
  return { list, text, items: list ? ordered : [] };
}

/** A checklist as Zeff writes it: "- [ ] …" / "- [x] …" lines. */
export const itemsToText = (items) => items.map((i) => `- [${i.checked ? "x" : " "}] ${String(i.text).replace(/\s*\n\s*/g, " ").trim()}`).join("\n");

/** Zeff's "- [ ]" lines back to items (other lines: unticked items, empty ones left out). */
export const textToItems = (text) =>
  String(text || "")
    .split("\n")
    .map((l) => /^\s*[-*]\s\[( |x|X)\]\s?(.*)$/.exec(l) ?? [null, " ", l])
    .map((m) => ({ text: String(m[2]).trim(), checked: /x/i.test(m[1]) }))
    .filter((i) => i.text);

/** Keep's colour names in its UI (German, English) ↔ the API's (what Zeff stores, lower case). */
export const COLOR_UI = {
  default: ["Standard", "Default"],
  red: ["Koralle", "Coral"],
  orange: ["Pfirsich", "Peach"],
  yellow: ["Sand", "Sand"],
  green: ["Minze", "Mint"],
  teal: ["Salbei", "Sage"],
  blue: ["Nebel", "Fog"],
  cerulean: ["Sturm", "Storm"],
  purple: ["Dämmerung", "Dusk"],
  pink: ["Blüte", "Blossom"],
  brown: ["Lehm", "Clay"],
  gray: ["Kreide", "Chalk"],
};
