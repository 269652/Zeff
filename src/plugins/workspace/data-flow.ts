/**
 * Where the data of a page goes: a table is read by a transform, a transform by a result table, a widget's shared value
 * (zeff.page.set / zeff.emit / zeff.publish) by another widget further up or down. Each connection gets a colour; the blocks on it
 * show a link and that colour. Pure and client-safe: it works on a list of the page's blocks in order.
 */

export type FlowBlock = {
  /** Where the block stands in the document. */
  pos: number;
  kind: "table" | "pipe" | "result" | "widget" | "code";
  /** What it is called as a source (a table's or transform's name); "" none. */
  name: string;
  /** Names it reads; "@above": the nearest block above that has a name to give. */
  reads: string[];
  /** What to call it where something else feeds it ("Result table"): a result table has no name of its own. */
  label?: string;
  /** Names it gives to others (a table and a transform: their own name; a widget: the values it shares). */
  writes: string[];
};

export type FlowLink = { name: string; from: number; to: number; color: string };
export type FlowMark = {
  /** The colour of the block's stripe: the first connection it is in. */
  color: string;
  /** Where it reads from (the source, its name, which way it lies from here). */
  reads: { name: string; color: string; dir: "up" | "down"; from: number }[];
  /** Whom it feeds. */
  feeds: { name: string; color: string; dir: "up" | "down"; to: number }[];
};

/** The colours of the pipelines — none of them near the colours of how a table is kept (green, yellow, blue: data-flow-ext.ts), so the two read apart. */
export const FLOW_COLORS = ["#38bdf8", "#ec4899", "#f97316", "#a16207", "#64748b", "#ef4444"];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What a widget's code shares and listens to, found in its text (zeff.page.set("k", …), zeff.emit("n", …), zeff.publish("n", …) …). */
export function widgetFlows(html: string): { reads: string[]; writes: string[] } {
  const grab = (re: RegExp) => [...new Set([...html.matchAll(re)].map((m) => m[1]))];
  const key = String.raw`\(\s*["'\x60]([^"'\x60]{1,80})["'\x60]`;
  const writes = [...grab(new RegExp(String.raw`zeff\s*\.\s*page\s*\.\s*set` + key, "g")), ...grab(new RegExp(String.raw`zeff\s*\.\s*emit` + key, "g")), ...grab(new RegExp(String.raw`zeff\s*\.\s*publish` + key, "g"))];
  const reads = [...grab(new RegExp(String.raw`zeff\s*\.\s*page\s*\.\s*get` + key, "g")), ...grab(new RegExp(String.raw`zeff\s*\.\s*on` + key, "g"))].filter((n) => n !== "changed" && n !== "page");
  return { reads, writes: [...new Set(writes)] };
}

/**
 * The connections between the blocks (in document order), and for each block what to show. Blocks that belong together — a table, the
 * transform that reads it, the result that shows that, widgets that share a value — are one data flow (a pipeline) and have its one
 * colour; another flow has another.
 */
export function computeFlows(blocks: FlowBlock[]): { links: FlowLink[]; marks: Map<number, FlowMark> } {
  const ordered = [...blocks].sort((a, b) => a.pos - b.pos);
  const raw: { name: string; writer: FlowBlock; reader: FlowBlock }[] = [];
  ordered.forEach((b, i) => {
    for (const r of b.reads) {
      let writer: FlowBlock | undefined;
      let name = r;
      if (r === "@above") {
        // The block above that has something to give (a transform, a named table).
        for (let k = i - 1; k >= 0 && !writer; k--) if ((ordered[k].kind === "pipe" || ordered[k].kind === "table" || ordered[k].kind === "code") && ordered[k].name.trim()) writer = ordered[k];
        name = writer?.name ?? "";
      } else {
        // The nearest block above that gives that name, else the nearest below (a widget lower on the page may be read by one above it).
        const gives = (x: FlowBlock) => x !== b && x.writes.some((w) => same(w, r));
        for (let k = i - 1; k >= 0 && !writer; k--) if (gives(ordered[k])) writer = ordered[k];
        for (let k = i + 1; k < ordered.length && !writer; k++) if (gives(ordered[k])) writer = ordered[k];
      }
      if (writer && name) raw.push({ name, writer, reader: b });
    }
  });

  // One flow = the blocks tied together by links.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const l of raw) {
    const a = find(l.writer.pos);
    const b = find(l.reader.pos);
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const colors = new Map<number, string>();
  for (const b of ordered) {
    if (!raw.some((l) => l.writer === b || l.reader === b)) continue;
    const root = find(b.pos);
    if (!colors.has(root)) colors.set(root, FLOW_COLORS[colors.size % FLOW_COLORS.length]);
  }

  const links: FlowLink[] = [];
  const marks = new Map<number, FlowMark>();
  const mark = (pos: number): FlowMark => {
    if (!marks.has(pos)) marks.set(pos, { color: "", reads: [], feeds: [] });
    return marks.get(pos)!;
  };
  for (const l of raw) {
    const color = colors.get(find(l.writer.pos))!;
    links.push({ name: l.name, from: l.writer.pos, to: l.reader.pos, color });
    const dir = l.writer.pos < l.reader.pos ? "up" : "down";
    const m = mark(l.reader.pos);
    m.reads.push({ name: l.name, color, dir, from: l.writer.pos });
    m.color = color;
    const w = mark(l.writer.pos);
    w.feeds.push({ name: l.reader.label || l.reader.name || l.reader.kind, color, dir: dir === "up" ? "down" : "up", to: l.reader.pos });
    w.color = color;
  }
  return { links, marks };
}
