/**
 * The red thread's way between two nodes of a skill map (pure, client-safe): through the map's white space, never across
 * a node or its title — level beside the circles where the cells on the way are empty, up and down in the gaps between
 * the columns, and along the strips between the rows where a straight way is taken. Corners rounded.
 */

export type Cell = { col: number; row: number };
export type Pt = { x: number; y: number };
export type Grid = {
  /** A column's width and a row's height; where the first row starts; a node's radius. */
  col: number;
  row: number;
  top: number;
  r: number;
  /** The map's size (the ways stay inside it). */
  width: number;
  height: number;
};

/** A node's centre (as SkillMap draws it). */
export const centre = (g: Grid, c: Cell): Pt => ({ x: c.col * g.col + g.col / 2, y: g.top + c.row * g.row + g.r + 8 });

/**
 * The strip above row `row`: between the titles of the row before (a circle, then up to two lines of title) and the
 * circles of this one — for row 0 between the bands' names and the first circles. Kept inside the map.
 */
export const laneY = (g: Grid, row: number) => Math.min(g.height - 10, Math.max(g.top - 5, g.top + row * g.row - 5));

/**
 * The corners of the way from a to b: out of a's side towards b, in at b's side towards a (both at circle height).
 * `taken(col, row)`: a node there. `shift`: how far the way's up-and-down part moves off the gap's middle (ways sharing
 * a gap kept apart).
 */
export function threadCorners(g: Grid, a: Cell, b: Cell, taken: (col: number, row: number) => boolean, shift = 0): Pt[] {
  const pa = centre(g, a);
  const pb = centre(g, b);
  if (a.col === b.col) {
    // One above the other: out to the right, down (or up) the gap after the column, back in.
    const x = (a.col + 1) * g.col + shift;
    return [{ x: pa.x + g.r, y: pa.y }, { x, y: pa.y }, { x, y: pb.y }, { x: pb.x + g.r, y: pb.y }];
  }
  const d = b.col > a.col ? 1 : -1;
  const start = { x: pa.x + d * g.r, y: pa.y };
  const end = { x: pb.x - d * g.r, y: pb.y };
  // The gap right after a and the one right before b (in the direction of travel).
  const xa = (d > 0 ? a.col + 1 : a.col) * g.col + shift;
  const xb = (d > 0 ? b.col : b.col + 1) * g.col + shift;
  const between: number[] = [];
  for (let c = Math.min(a.col, b.col) + 1; c < Math.max(a.col, b.col); c++) between.push(c);
  const free = (row: number) => between.every((c) => !taken(c, row));
  if (a.row === b.row && free(a.row)) return [start, end];
  if (free(a.row)) return [start, { x: xb, y: pa.y }, { x: xb, y: pb.y }, end];
  if (free(b.row)) return [start, { x: xa, y: pa.y }, { x: xa, y: pb.y }, end];
  // Nodes on both rows: over the strip between the rows (or the one below a row of its own; above, at the map's foot).
  const lane = a.row === b.row ? (a.row + 1) * g.row + g.top < g.height ? a.row + 1 : a.row : Math.min(a.row, b.row) + 1;
  const y = laneY(g, lane);
  return [start, { x: xa, y: pa.y }, { x: xa, y }, { x: xb, y }, { x: xb, y: pb.y }, end];
}

/** Corners without the points that add nothing (twice the same, or on a straight stretch). */
function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) continue;
    const o = out[out.length - 2];
    if (o && q && ((Math.abs(o.x - q.x) < 0.5 && Math.abs(q.x - p.x) < 0.5) || (Math.abs(o.y - q.y) < 0.5 && Math.abs(q.y - p.y) < 0.5))) out.pop();
    out.push(p);
  }
  return out;
}

/** An SVG path along the corners, each corner rounded (radius up to `round`, at most half of either stretch). */
export function roundedPath(corners: Pt[], round = 12): string {
  const pts = tidy(corners);
  if (!pts.length) return "";
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    if (!next) {
      d += ` L${p.x},${p.y}`;
      break;
    }
    const prev = pts[i - 1];
    const lin = Math.hypot(p.x - prev.x, p.y - prev.y);
    const lout = Math.hypot(next.x - p.x, next.y - p.y);
    const k = Math.min(round, lin / 2, lout / 2);
    const a = { x: p.x + ((prev.x - p.x) / lin) * k, y: p.y + ((prev.y - p.y) / lin) * k };
    const b = { x: p.x + ((next.x - p.x) / lout) * k, y: p.y + ((next.y - p.y) / lout) * k };
    d += ` L${a.x},${a.y} Q${p.x},${p.y} ${b.x},${b.y}`;
  }
  return d;
}

/**
 * Where a stretch's number goes: the middle of its longest straight part — or, where a number is already near (ways
 * sharing a gap), the middle of the next longest, else a point along the way clear of them. `placed`: the numbers so far.
 */
export function labelPoint(corners: Pt[], placed: Pt[], clear = 22): Pt {
  const pts = tidy(corners);
  const free = (p: Pt) => placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= clear);
  const parts = pts
    .slice(1)
    .map((p, i) => ({ a: pts[i], b: p, len: Math.hypot(p.x - pts[i].x, p.y - pts[i].y) }))
    .sort((x, y) => y.len - x.len);
  for (const { a, b } of parts) {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (free(m)) return m;
  }
  for (const t of [0.3, 0.7, 0.2, 0.8]) {
    for (const { a, b } of parts) {
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (free(m)) return m;
    }
  }
  return parts.length ? { x: (parts[0].a.x + parts[0].b.x) / 2, y: (parts[0].a.y + parts[0].b.y) / 2 } : halfway(corners);
}

/** The point halfway along the corners. */
export function halfway(corners: Pt[]): Pt {
  const pts = tidy(corners);
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let left = lens.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] && lens[i] > 0) {
      const t = left / lens[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    left -= lens[i];
  }
  return pts[0] ?? { x: 0, y: 0 };
}
