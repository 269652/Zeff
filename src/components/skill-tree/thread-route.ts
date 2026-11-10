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
  // (The gaps at the map's edges: a little inside it, not on its border.)
  const gap = (x: number) => Math.min(g.width - 16, Math.max(16, x));
  const pa = centre(g, a);
  const pb = centre(g, b);
  if (a.col === b.col) {
    // One above the other: out to the right, down (or up) the gap after the column, back in.
    const x = gap((a.col + 1) * g.col + shift);
    return [{ x: pa.x + g.r, y: pa.y }, { x, y: pa.y }, { x, y: pb.y }, { x: pb.x + g.r, y: pb.y }];
  }
  const d = b.col > a.col ? 1 : -1;
  const start = { x: pa.x + d * g.r, y: pa.y };
  const end = { x: pb.x - d * g.r, y: pb.y };
  // The gap right after a and the one right before b (in the direction of travel).
  const xa = gap((d > 0 ? a.col + 1 : a.col) * g.col + shift);
  const xb = gap((d > 0 ? b.col : b.col + 1) * g.col + shift);
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

// ---------------------------------------------------------------------------------------------------------------------
// Organic ways: a soft curve along the corridor, cut short where the map is free — only the circles are in the way (the
// titles sit on cards of their own over the lines, so a line may run behind them)
// ---------------------------------------------------------------------------------------------------------------------

/** Something a way keeps out of: a node's circle (a little more), a number's badge. */
export type Disc = { x: number; y: number; r: number };

/** The circles of the nodes as discs to keep out of, `pad` around them. */
export const nodeDiscs = (g: Grid, cells: Cell[], pad = 6): Disc[] => cells.map((c) => ({ ...centre(g, c), r: g.r + pad }));

const inDisc = (p: Pt, discs: Disc[]) => discs.some((d) => Math.hypot(p.x - d.x, p.y - d.y) < d.r);

/** Whether the straight way a → b stays out of the discs and inside the map. */
function clearLine(a: Pt, b: Pt, discs: Disc[], g: Grid): boolean {
  const n = Math.max(8, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  for (let i = 1; i < n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    if (inDisc(p, discs) || p.x < 4 || p.x > g.width - 4 || p.y < 4 || p.y > g.height - 4) return false;
  }
  return true;
}

type Seg = [Pt, Pt, Pt, Pt];

const bez = ([p0, p1, p2, p3]: Seg, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

/** Cubic pieces through the points (Catmull-Rom), leaving the first along `out` and coming into the last along `into`. */
function spline(pts: Pt[], out: Pt, into: Pt, tension: number): Seg[] {
  const unit = (v: Pt) => {
    const l = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / l, y: v.y / l };
  };
  const tan = pts.map((p, i) => {
    const len = Math.hypot((pts[i + 1] ?? p).x - (pts[i - 1] ?? p).x, (pts[i + 1] ?? p).y - (pts[i - 1] ?? p).y);
    if (i === 0) {
      const u = unit(out);
      const l = Math.hypot(pts[1].x - p.x, pts[1].y - p.y);
      return { x: u.x * l * tension * 1.2, y: u.y * l * tension * 1.2 };
    }
    if (i === pts.length - 1) {
      const u = unit(into);
      const l = Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      return { x: u.x * l * tension * 1.2, y: u.y * l * tension * 1.2 };
    }
    const u = unit({ x: pts[i + 1].x - pts[i - 1].x, y: pts[i + 1].y - pts[i - 1].y });
    return { x: (u.x * len * tension) / 2, y: (u.y * len * tension) / 2 };
  });
  return pts.slice(1).map((p, i) => [pts[i], { x: pts[i].x + tan[i].x / 3, y: pts[i].y + tan[i].y / 3 }, { x: p.x - tan[i + 1].x / 3, y: p.y - tan[i + 1].y / 3 }, p] as Seg);
}

const sampleSegs = (segs: Seg[], per = 18): Pt[] => [segs[0][0], ...segs.flatMap((s) => Array.from({ length: per }, (_, i) => bez(s, (i + 1) / per)))];

/** The corners with the detours left out that the map doesn't need: from each point on to the farthest one in plain sight. */
function pulled(pts: Pt[], discs: Disc[], g: Grid): Pt[] {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(pts[i], pts[j], discs, g)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/**
 * The red thread's way as a soft curve: the corridor's corners (threadCorners) cut short where the map is free, a smooth
 * curve through what is left — leaving and entering the circles level, as the corridor does. Checked: a curve that would
 * touch a circle (`discs`: the other nodes') is drawn tighter, then along all the corners; failing that, the corridor with
 * wide round corners. `samples`: points along it (for its number, and to keep the others' numbers off it).
 */
export function organicWay(g: Grid, corners: Pt[], discs: Disc[]): { d: string; samples: Pt[] } {
  const all = tidy(corners);
  if (all.length < 2) return { d: roundedPath(corners), samples: all };
  const out = { x: all[1].x - all[0].x, y: all[1].y - all[0].y };
  const into = { x: all[all.length - 1].x - all[all.length - 2].x, y: all[all.length - 1].y - all[all.length - 2].y };
  // (Level out of the circle: its first stretch is level in the corridor.)
  const lvl = (v: Pt) => (Math.abs(v.y) < 0.5 ? v : { x: Math.sign(v.x) || 1, y: 0 });
  const ok = (s: Pt[]) => s.every((p) => !inDisc(p, discs) && p.x >= 3 && p.x <= g.width - 3 && p.y >= 3 && p.y <= g.height - 3);
  for (const pts of [pulled(all, discs, g), all]) {
    for (const tension of [1, 0.7, 0.45]) {
      const segs = spline(pts, lvl(out), lvl(into), tension);
      const samples = sampleSegs(segs);
      if (!ok(samples)) continue;
      const f = (n: number) => Math.round(n * 10) / 10;
      const d = `M${f(pts[0].x)},${f(pts[0].y)}` + segs.map(([, c1, c2, p]) => ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p.x)},${f(p.y)}`).join("");
      return { d, samples };
    }
  }
  const dense = all.slice(1).flatMap((p, i) => Array.from({ length: 12 }, (_, k) => ({ x: all[i].x + ((p.x - all[i].x) * (k + 1)) / 12, y: all[i].y + ((p.y - all[i].y) * (k + 1)) / 12 })));
  return { d: roundedPath(corners, 24), samples: [all[0], ...dense] };
}

/** The point at `frac` of the way along sampled points. */
export function alongWay(samples: Pt[], frac: number): Pt {
  const lens = samples.slice(1).map((p, i) => Math.hypot(p.x - samples[i].x, p.y - samples[i].y));
  let left = lens.reduce((s, l) => s + l, 0) * frac;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] && lens[i] > 0) {
      const t = left / lens[i];
      return { x: samples[i].x + (samples[i + 1].x - samples[i].x) * t, y: samples[i].y + (samples[i + 1].y - samples[i].y) * t };
    }
    left -= lens[i];
  }
  return samples[samples.length - 1] ?? { x: 0, y: 0 };
}

/**
 * Where each way's number goes: on its way, as near its middle as can be, clear of the circles, of the numbers placed
 * before and of the other ways (no line runs through another's badge).
 */
export function wayLabels(ways: Pt[][], discs: Disc[], badge = 10): Pt[] {
  const placed: Pt[] = [];
  const near = (p: Pt, pts: Pt[], d: number) => pts.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < d);
  ways.forEach((samples, i) => {
    const others = ways.filter((_, j) => j !== i).flat();
    const fracs = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
    const clear = (p: Pt, strict: boolean) => !inDisc(p, discs.map((d) => ({ ...d, r: d.r + badge }))) && !near(p, placed, badge * 2.4) && (!strict || !near(p, others, badge + 3));
    const p = fracs.map((f) => alongWay(samples, f)).find((q) => clear(q, true)) ?? fracs.map((f) => alongWay(samples, f)).find((q) => clear(q, false)) ?? alongWay(samples, 0.5);
    placed.push(p);
  });
  return placed;
}
