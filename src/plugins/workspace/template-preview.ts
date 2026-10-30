/**
 * A built-in template's preview, from what its dry run made (the Workspace plugin): the pages and databases are rolled back after, so
 * every block that points at one of them — a database view, an embedded page, a form, a to-do list, a widget reading it, the controls
 * of a routine whose page is not kept — is drawn as a static card of what will be there (the database's fields, views and examples,
 * the page's title). Nothing in it is looked up live. Pure: the dry run's data in, the preview out.
 */

/** A page or database the template made (read before the rollback). */
export type MadePage = {
  id: number;
  parentId: number | null;
  title: string;
  icon: string;
  kind: string;
  /** A database's: what its title column is called, its fields, its views, a few example rows' titles and how many there are. */
  titleName?: string;
  properties: { name: string; type: string }[];
  views: string[];
  examples: string[];
  rows: number;
};
export type PreviewDatabase = { title: string; icon: string; properties: { name: string; type: string }[]; views: string[]; rows: number };
type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: unknown[] };
type T = (s: string, v?: Record<string, string | number>) => string;

/** The attributes that name a page or database by id. */
const ID_ATTRS = ["dbId", "pageId", "formId"];
/** Blocks that only work on a page that is kept (its routine, its row): a card instead. */
const pageBound = (t: T): Record<string, [string, string]> => ({
  zeffRoutine: ["🤖", t("The routine's controls — run, when, what it may do. Here once the page is made.")],
  rowView: ["🧾", t("The row's fields — here once the page is made.")],
  zeffBelongs: ["🔗", t("What belongs to this page — here once it is made.")],
  zeffActivity: ["🕒", t("What happened on this page — here once it is made.")],
});
const MAX_FIELDS = 8;

const text = (s: string, bold = false): Node => ({ type: "text", text: s, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const card = (icon: string, head: string, line?: string): Node => ({
  type: "callout",
  attrs: { icon, tone: "gray" },
  content: [{ type: "paragraph", content: [text(head, true)] }, ...(line ? [{ type: "paragraph", content: [text(line)] }] : [])],
});

/** The card of a made page or database. */
function madeCard(p: MadePage, t: T): Node {
  const name = p.title || t("Untitled");
  if (p.kind !== "database") return card(p.icon || (p.kind === "form" ? "📝" : "📄"), p.kind === "form" ? t("Form “{name}”", { name }) : t("Sub-page “{name}”", { name }));
  const fields = [...(p.titleName ? [p.titleName] : []), ...p.properties.map((x) => x.name)];
  const parts = [
    `${t("Fields")}: ${fields.slice(0, MAX_FIELDS).join(", ")}${fields.length > MAX_FIELDS ? " …" : ""}`,
    ...(p.views.length ? [`${t("Views")}: ${p.views.join(", ")}`] : []),
    ...(p.examples.length ? [`${t("Examples")}: ${p.examples.join(", ")}`] : []),
  ];
  return card(p.icon || "🗂️", t("Database “{name}”", { name }), parts.join(" · "));
}

/** The made page a block points at (by an id attribute, or a widget's settings naming its id), or null. */
function target(n: Node, made: Map<number, MadePage>): MadePage | null {
  for (const a of ID_ATTRS) {
    const v = Number(n.attrs?.[a]);
    if (v && made.has(v)) return made.get(v)!;
  }
  if (n.type === "zeffWidget" && typeof n.attrs?.config === "string") {
    try {
      for (const v of Object.values(JSON.parse(n.attrs.config) as Record<string, unknown>)) {
        const id = typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)) ? Number(v) : 0;
        if (id && made.has(id)) return made.get(id)!;
      }
    } catch {
      // settings that are no JSON: nothing of the template's
    }
  }
  return null;
}

/** The blocks with every pointer at a made page swapped for its card (a mention of one: its name as text). */
function swap(nodes: Node[], made: Map<number, MadePage>, t: T, shown: Set<number>): Node[] {
  const bounds = pageBound(t);
  return nodes.map((n): Node => {
    if (n.type === "zeffRef" && n.attrs?.kind === "page" && made.has(Number(n.attrs.ref))) return text(String(n.attrs.label || made.get(Number(n.attrs.ref))!.title));
    const to = target(n, made);
    if (to) {
      shown.add(to.id);
      return madeCard(to, t);
    }
    const bound = bounds[n.type];
    if (bound) return card(...bound);
    return n.content ? { ...n, content: swap(n.content, made, t, shown) } : n;
  });
}

const asDatabase = (p: MadePage): PreviewDatabase => ({ title: p.title, icon: p.icon, properties: p.properties, views: p.views, rows: p.rows });

/**
 * The preview of what a template made: its page with the cards in place of the live blocks, what is directly below it, and the
 * databases it makes that the page doesn't show as a card already (a database template: itself).
 */
export function previewParts(root: MadePage & { content: unknown; fullWidth: boolean }, made: MadePage[], t: T): { page: { title: string; icon: string; content: unknown; fullWidth: boolean }; children: { title: string; icon: string; kind: string }[]; databases: PreviewDatabase[] } {
  const byId = new Map(made.map((p) => [p.id, p]));
  const shown = new Set<number>();
  const doc = root.content as Node | null;
  const content = doc?.content ? { ...doc, content: swap(doc.content, byId, t, shown) } : doc;
  return {
    page: { title: root.title, icon: root.icon, content, fullWidth: root.fullWidth },
    children: made.filter((p) => p.parentId === root.id).map((p) => ({ title: p.title, icon: p.icon, kind: p.kind })),
    databases: made.filter((p) => p.kind === "database" && !shown.has(p.id)).map(asDatabase),
  };
}
