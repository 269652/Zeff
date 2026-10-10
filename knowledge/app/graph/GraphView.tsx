"use client";

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntityDetail } from "@k/graph";
import { styleOf } from "@k/graph-style";

/** The graph as it comes from the server: compact rows — [id, name, type, pages, degree] and [source, target, relation, count]. */
export type CompactGraph = { nodes: [number, string, string, number, number][]; links: [number, number, string, number][] };

type N = SimulationNodeDatum & { id: number; name: string; type: string; pages: number; degree: number; r: number };
type L = SimulationLinkDatum<N> & { rel: string; n: number };

type View = { k: number; x: number; y: number };

/**
 * The whole knowledge graph, drawn: each entity a dot in its type's colour (bigger the more it's
 * connected), each relation a line; the layout settles itself (forces). Zoom with the wheel, move
 * by dragging the background, drag a dot to move it. Hovering lights up a dot and its neighbours,
 * a click opens it (what it is, every relation, its pages) — and its neighbourhood alone can be
 * shown. Types filter, the search finds a name.
 */
export function GraphView({ data, initial, initialDetail, load }: { data: CompactGraph; initial: number | null; initialDetail: EntityDetail | null; load: (id: number) => Promise<EntityDetail | null> }) {
  const all = useMemo(() => {
    const nodes = data.nodes.map(([id, name, type, pages, degree]) => ({ id, name, type, pages, degree }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = data.links.filter(([s, t]) => byId.has(s) && byId.has(t)).map(([s, t, rel, n]) => ({ s, t, rel, n }));
    const adj = new Map<number, number[]>();
    for (const l of links) {
      adj.set(l.s, [...(adj.get(l.s) ?? []), l.t]);
      adj.set(l.t, [...(adj.get(l.t) ?? []), l.s]);
    }
    const types = [...new Set(nodes.map((n) => n.type))].sort((a, b) => nodes.filter((n) => n.type === b).length - nodes.filter((n) => n.type === a).length);
    return { nodes, byId, links, adj, types };
  }, [data]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState(false);
  const [focus, setFocus] = useState<{ id: number; depth: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(initial);
  const [detail, setDetail] = useState<EntityDetail | null>(initialDetail);
  const [query, setQuery] = useState("");
  const [settling, setSettling] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<N, L> | null>(null);
  const nodesRef = useRef<N[]>([]);
  const linksRef = useRef<L[]>([]);
  const viewRef = useRef<View>({ k: 1, x: 0, y: 0 });
  const hoverRef = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(initial);
  const posRef = useRef(new Map<number, { x: number; y: number }>());
  const sizeRef = useRef({ w: 800, h: 600 });
  const frameRef = useRef(0);
  const fittedRef = useRef(false);
  // The view moved by you (zoom, pan, a dot centred): no fitting by itself any more — until "Alles einpassen".
  const touchedRef = useRef(false);
  const settlingRef = useRef(true);
  const detailRef = useRef<EntityDetail | null>(initialDetail);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // What's shown: the types not filtered out, the unconnected only when asked, a neighbourhood when one is chosen.
  const visible = useMemo(() => {
    let ids = new Set(all.nodes.filter((n) => !hidden.has(n.type) && (isolated || n.degree > 0)).map((n) => n.id));
    if (focus && all.byId.has(focus.id)) {
      const near = new Set([focus.id]);
      let edge = [focus.id];
      for (let d = 0; d < focus.depth; d++) {
        const next: number[] = [];
        for (const id of edge) for (const o of all.adj.get(id) ?? []) if (!near.has(o) && (ids.has(o) || o === focus.id)) (near.add(o), next.push(o));
        edge = next;
      }
      ids = near;
    }
    if (selected !== null && all.byId.has(selected)) ids.add(selected);
    return { ids, links: all.links.filter((l) => ids.has(l.s) && ids.has(l.t)) };
  }, [all, hidden, isolated, focus, selected]);

  const neighbours = useCallback((id: number | null) => (id === null ? null : new Set([id, ...(all.adj.get(id) ?? [])])), [all]);

  /** One frame: the lines, the dots, the names where there's room (and always for what's lit up). */
  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
    const lit = neighbours(hoverRef.current ?? selectedRef.current);
    const style = getComputedStyle(canvas);
    const ink = style.color || "#18181b";
    // The halo behind names: the card's own background (light or dark).
    const bg = canvas.parentElement ? getComputedStyle(canvas.parentElement).backgroundColor : "";
    const paper = bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff";

    // Lines: all faint; those of what's lit up strong.
    ctx.lineWidth = 1 / v.k;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = lit ? 0.06 : 0.14;
    ctx.beginPath();
    for (const l of linksRef.current) {
      const s = l.source as N;
      const t = l.target as N;
      if (lit && lit.has(s.id) && lit.has(t.id) && (s.id === (hoverRef.current ?? selectedRef.current) || t.id === (hoverRef.current ?? selectedRef.current))) continue;
      ctx.moveTo(s.x!, s.y!);
      ctx.lineTo(t.x!, t.y!);
    }
    ctx.stroke();
    if (lit) {
      const c = hoverRef.current ?? selectedRef.current;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.6 / v.k;
      ctx.beginPath();
      for (const l of linksRef.current) {
        const s = l.source as N;
        const t = l.target as N;
        if (s.id !== c && t.id !== c) continue;
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
      }
      ctx.stroke();
    }

    // Dots.
    for (const n of nodesRef.current) {
      ctx.globalAlpha = lit && !lit.has(n.id) ? 0.15 : 1;
      ctx.fillStyle = styleOf(n.type).color;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (n.id === selectedRef.current) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3 / v.k;
        ctx.strokeStyle = ink;
        ctx.stroke();
      }
    }

    // Names: big dots once zoomed in enough, and everything lit up. Same size on screen whatever the zoom.
    ctx.globalAlpha = 1;
    ctx.font = `${12 / v.k}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    // Many lit up: the names of the best-connected 40 (and the one in the middle), else they're unreadable.
    let named = lit;
    if (lit && lit.size > 41) {
      const c = hoverRef.current ?? selectedRef.current;
      named = new Set([c!, ...nodesRef.current.filter((n) => lit.has(n.id) && n.id !== c).sort((a, b) => b.degree - a.degree).slice(0, 40).map((n) => n.id)]);
    }
    const left = -v.x / v.k;
    const top = -v.y / v.k;
    const right = left + w / v.k;
    const bottom = top + h / v.k;
    for (const n of nodesRef.current) {
      const isNamed = named?.has(n.id);
      if (!isNamed && (lit || n.r * v.k < 6)) continue;
      if (n.x! < left - 50 || n.x! > right || n.y! < top || n.y! > bottom) continue;
      const label = n.name.length > 40 ? `${n.name.slice(0, 39)}…` : n.name;
      const x = n.x! + n.r + 3 / v.k;
      ctx.lineWidth = 3 / v.k;
      ctx.strokeStyle = paper;
      ctx.strokeText(label, x, n.y!);
      ctx.fillStyle = ink;
      ctx.fillText(label, x, n.y!);
    }
    ctx.globalAlpha = 1;
  }, [neighbours]);

  const redraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  /** The view fitted around what's shown. */
  const fit = useCallback(() => {
    const ns = nodesRef.current;
    if (!ns.length) return;
    const xs = ns.map((n) => n.x!);
    const ys = ns.map((n) => n.y!);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const { w, h } = sizeRef.current;
    const k = Math.min(4, 0.92 * Math.min(w / Math.max(x1 - x0, 1), h / Math.max(y1 - y0, 1)));
    viewRef.current = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    touchedRef.current = false;
    redraw();
  }, [redraw]);

  /** One dot in the middle, close enough to read its neighbours. */
  const centerOn = useCallback(
    (id: number) => {
      const n = nodesRef.current.find((x) => x.id === id);
      if (!n) return;
      const { w, h } = sizeRef.current;
      const k = Math.max(viewRef.current.k, 1.4);
      viewRef.current = { k, x: w / 2 - n.x! * k, y: h / 2 - n.y! * k };
      touchedRef.current = true;
      redraw();
    },
    [redraw],
  );

  // The layout: rebuilt for what's shown — dots keep where they were.
  useEffect(() => {
    simRef.current?.stop();
    const pos = posRef.current;
    const nodes: N[] = all.nodes
      .filter((n) => visible.ids.has(n.id))
      .map((n) => ({ ...n, r: 2.5 + Math.sqrt(n.degree) * 1.6, ...(pos.get(n.id) ?? {}) }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: L[] = visible.links.map((l) => ({ source: byId.get(l.s)!, target: byId.get(l.t)!, rel: l.rel, n: l.n }));
    nodesRef.current = nodes;
    linksRef.current = links;
    const fresh = nodes.some((n) => !pos.has(n.id));
    const sim = forceSimulation<N, L>(nodes)
      .force("charge", forceManyBody<N>().strength((n) => -25 - Math.min(n.degree, 60) * 3).theta(0.9).distanceMax(600))
      .force("link", forceLink<N, L>(links).distance((l) => 24 + Math.min(((l.source as N).r + (l.target as N).r) * 2, 60)))
      .force("collide", forceCollide<N>((n) => n.r + 1.5))
      .force("x", forceX<N>(0).strength(0.04))
      .force("y", forceY<N>(0).strength(0.04))
      .alphaDecay(0.035)
      .alpha(fresh ? 1 : 0.3)
      .stop();
    // A head start without drawing (a big graph untangles faster that way), then live.
    const warm = fresh ? Math.min(120, Math.ceil(200000 / Math.max(nodes.length, 1))) : 0;
    for (let i = 0; i < warm; i++) sim.tick();
    sim.on("tick", () => {
      if (!settlingRef.current) {
        settlingRef.current = true;
        setSettling(true);
      }
      for (const n of nodes) pos.set(n.id, { x: n.x!, y: n.y! });
      redraw();
    });
    sim.on("end", () => {
      settlingRef.current = false;
      setSettling(false);
      for (const n of nodes) pos.set(n.id, { x: n.x!, y: n.y! });
      // Settled: fitted around where everything ended up (unless you moved the view meanwhile).
      if (!touchedRef.current) fit();
    });
    simRef.current = sim;
    sim.restart();
    if (!fittedRef.current || focus) {
      fittedRef.current = true;
      fit();
      if (selectedRef.current !== null && !focus) centerOn(selectedRef.current);
    }
    redraw();
    return () => void sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new layout for what's shown, not for each redraw function
  }, [visible]);

  // The canvas as big as its box, sharp on high-density screens.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: r.width, h: r.height };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (!touchedRef.current) fit();
      else redraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw, fit]);

  // What's open: its details, the address naming it (a link to it), its neighbours lit up.
  useEffect(() => {
    selectedRef.current = selected;
    redraw();
    const url = new URL(window.location.href);
    if (selected === null) url.searchParams.delete("e");
    else url.searchParams.set("e", String(selected));
    window.history.replaceState(null, "", url);
    // Loaded already (the one the page opened with comes along with it).
    if (selected === null || detailRef.current?.id === selected) return;
    let gone = false;
    void load(selected).then((d) => !gone && setDetail(d));
    return () => {
      gone = true;
    };
  }, [selected, load, redraw]);

  const select = useCallback(
    (id: number | null, center = false) => {
      setSelected(id);
      if (id !== null && center) requestAnimationFrame(() => centerOn(id));
    },
    [centerOn],
  );

  // Mouse and touch: the wheel zooms where it points; dragging moves the view, or a dot; a click opens a dot.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k, sx: e.clientX - r.left, sy: e.clientY - r.top };
    };
    const hit = (p: { x: number; y: number }) => {
      let best: N | null = null;
      let bestD = Infinity;
      const slack = 4 / viewRef.current.k;
      for (const n of nodesRef.current) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        if (d <= n.r + slack && d < bestD) (best = n), (bestD = d);
      }
      return best;
    };
    let drag: { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean } | { kind: "node"; n: N; moved: boolean; sx: number; sy: number } | null = null;
    // Two fingers: pinching zooms around the point between them (and moves with them).
    const fingers = new Map<number, { sx: number; sy: number }>();
    let pinch: { d0: number; k0: number; wx: number; wy: number } | null = null;
    const between = () => {
      const [a, b] = [...fingers.values()];
      return { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touchedRef.current = true;
      const p = world(e);
      const v = viewRef.current;
      const k = Math.min(10, Math.max(0.03, v.k * Math.exp(-e.deltaY * 0.0015)));
      viewRef.current = { k, x: p.sx - p.x * k, y: p.sy - p.y * k };
      redraw();
    };
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = world(e);
      fingers.set(e.pointerId, { sx: p.sx, sy: p.sy });
      if (fingers.size === 2) {
        if (drag?.kind === "node") (drag.n.fx = null), (drag.n.fy = null);
        drag = null;
        const m = between();
        const v = viewRef.current;
        pinch = { d0: Math.max(m.d, 1), k0: v.k, wx: (m.sx - v.x) / v.k, wy: (m.sy - v.y) / v.k };
        touchedRef.current = true;
        return;
      }
      const n = hit(p);
      if (n) {
        drag = { kind: "node", n, moved: false, sx: p.sx, sy: p.sy };
        n.fx = n.x;
        n.fy = n.y;
      } else drag = { kind: "pan", sx: p.sx, sy: p.sy, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const p = world(e);
      if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { sx: p.sx, sy: p.sy });
      if (pinch && fingers.size === 2) {
        const m = between();
        const k = Math.min(10, Math.max(0.03, (pinch.k0 * m.d) / pinch.d0));
        viewRef.current = { k, x: m.sx - pinch.wx * k, y: m.sy - pinch.wy * k };
        redraw();
        return;
      }
      if (!drag) {
        const n = hit(p);
        const id = n?.id ?? null;
        canvas.style.cursor = n ? "pointer" : "grab";
        canvas.title = n ? `${n.name} — ${styleOf(n.type).label}, ${n.degree} Beziehungen, ${n.pages} Seiten` : "";
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          redraw();
        }
        return;
      }
      if (Math.hypot(p.sx - drag.sx, p.sy - drag.sy) > 4) drag.moved = true;
      if (drag.kind === "pan") {
        viewRef.current = { ...viewRef.current, x: drag.vx + p.sx - drag.sx, y: drag.vy + p.sy - drag.sy };
        if (drag.moved) touchedRef.current = true;
        canvas.style.cursor = "grabbing";
        redraw();
      } else if (drag.moved) {
        drag.n.fx = p.x;
        drag.n.fy = p.y;
        simRef.current?.alphaTarget(0.25).restart();
      }
    };
    const onUp = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (fingers.size < 2) pinch = null;
      if (!drag) return;
      if (drag.kind === "node") {
        drag.n.fx = null;
        drag.n.fy = null;
        simRef.current?.alphaTarget(0);
        if (!drag.moved) select(drag.n.id);
      } else if (!drag.moved) select(null);
      drag = null;
      canvas.style.cursor = "grab";
    };
    const onLeave = () => {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        redraw();
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [redraw, select]);

  /** The search: an exact name first, else the best-connected one containing it. */
  const find = (q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return;
    const exact = all.nodes.find((n) => n.name.toLowerCase() === s);
    const found = exact ?? [...all.nodes].filter((n) => n.name.toLowerCase().includes(s)).sort((a, b) => b.degree - a.degree)[0];
    if (!found) return;
    // Hidden by a filter: shown again.
    if (hidden.has(found.type)) setHidden((h) => new Set([...h].filter((t) => t !== found.type)));
    if (found.degree === 0) setIsolated(true);
    if (focus && !visible.ids.has(found.id)) setFocus(null);
    select(found.id, true);
  };

  const counts = useMemo(() => Object.fromEntries(all.types.map((t) => [t, all.nodes.filter((n) => n.type === t).length])), [all]);
  const sel = selected !== null ? all.byId.get(selected) : undefined;
  // Relations by the entity on the other end.
  const grouped = useMemo(() => {
    if (!detail) return [];
    const m = new Map<number, { other: EntityDetail["relations"][number]["other"]; items: EntityDetail["relations"] }>();
    for (const r of detail.relations) {
      const g = m.get(r.other.id) ?? { other: r.other, items: [] };
      g.items.push(r);
      m.set(r.other.id, g);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.other.name.localeCompare(b.other.name));
  }, [detail]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              find(query);
            }}
          >
            <input list="graph-names" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Entität suchen …" className="input w-64" aria-label="Entität suchen" />
            <datalist id="graph-names">
              {all.nodes
                .filter((n) => n.degree > 0)
                .sort((a, b) => b.degree - a.degree)
                .slice(0, 1500)
                .map((n) => (
                  <option key={n.id} value={n.name} />
                ))}
            </datalist>
            <button className="btn">Finden</button>
          </form>
          <button type="button" className="btn btn-sm" onClick={fit}>
            Alles einpassen
          </button>
          {focus && (
            <button type="button" className="btn btn-sm" onClick={() => setFocus(null)}>
              Ganzen Graphen zeigen
            </button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input type="checkbox" checked={isolated} onChange={(e) => setIsolated(e.target.checked)} />
            Unverbundene ({all.nodes.filter((n) => n.degree === 0).length})
          </label>
          <span className="ml-auto text-xs text-zinc-500">
            {visible.ids.size} Entitäten · {visible.links.length} Verbindungen{settling ? " · ordnet sich …" : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Typen">
          {all.types.map((t) => {
            const off = hidden.has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={!off}
                onClick={() => setHidden((h) => (h.has(t) ? new Set([...h].filter((x) => x !== t)) : new Set([...h, t])))}
                onDoubleClick={() => setHidden(new Set(all.types.filter((x) => x !== t)))}
                title="Klick: ein-/ausblenden · Doppelklick: nur diesen Typ"
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${off ? "border-zinc-200 text-zinc-400 dark:border-zinc-800" : "border-zinc-300 dark:border-zinc-700"}`}
              >
                <span className="size-2.5 rounded-full" style={{ background: styleOf(t).color, opacity: off ? 0.3 : 1 }} />
                {styleOf(t).label} <span className="text-zinc-400">{counts[t]}</span>
              </button>
            );
          })}
        </div>
        <div ref={wrapRef} className="graph-canvas card relative h-[calc(100vh-15rem)] min-h-[420px] overflow-hidden p-0">
          <canvas ref={canvasRef} className="block touch-none text-zinc-900 dark:text-zinc-100" style={{ cursor: "grab" }} />
          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-zinc-400">Mausrad: zoomen · Ziehen: verschieben · Klick: öffnen</p>
        </div>
      </div>

      <aside className="w-full shrink-0 space-y-3 lg:w-96">
        {!sel ? (
          <div className="card space-y-2 p-4 text-sm text-zinc-500">
            <p>Klick auf einen Punkt: was die Entität ist, mit wem sie wie verbunden ist, auf welchen Seiten sie steht.</p>
            <p>Größere Punkte haben mehr Beziehungen. Die Farben sind die Typen — oben ein- und ausblendbar.</p>
          </div>
        ) : (
          <div className="card max-h-[calc(100vh-10rem)] space-y-3 overflow-x-hidden overflow-y-auto p-4 break-words">
            <div className="flex items-start gap-2">
              <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: styleOf(sel.type).color }} />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold break-words">{sel.name}</h2>
                <p className="text-xs text-zinc-500">
                  {styleOf(sel.type).label} · {sel.degree} verbunden · {sel.pages} Seiten
                </p>
              </div>
              <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => select(null)}>
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3].map((d) => (
                <button key={d} type="button" className={`btn btn-sm ${focus?.id === sel.id && focus.depth === d ? "btn-primary" : ""}`} onClick={() => setFocus({ id: sel.id, depth: d })}>
                  {d === 1 ? "Nur Nachbarn" : `${d} Schritte`}
                </button>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => centerOn(sel.id)}>
                Hinzoomen
              </button>
            </div>
            {detail?.id !== sel.id && <p className="text-sm text-zinc-500">Lädt …</p>}
            {detail && detail.id === sel.id && (
              <>
                {detail.summary && <p className="text-sm">{detail.summary}</p>}
                {detail.aliases.length > 0 && <p className="text-xs text-zinc-500">Auch: {detail.aliases.join(", ")}</p>}
                {grouped.length > 0 && (
                  <section className="space-y-1">
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase">Beziehungen ({detail.relations.length})</h3>
                    <ul className="space-y-1 text-sm">
                      {grouped.map((g) => (
                        <li key={g.other.id}>
                          <button type="button" className="flex items-baseline gap-1.5 text-left hover:underline" onClick={() => select(g.other.id, true)}>
                            <span className="size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: styleOf(g.other.type).color }} />
                            <span className="font-medium">{g.other.name}</span>
                          </button>
                          <ul className="ml-3.5 text-xs text-zinc-500">
                            {g.items.slice(0, 4).map((r, i) => (
                              <li key={i} title={r.fact || undefined}>
                                {r.dir === "out" ? `→ ${r.rel}` : `← ${r.rel}`}
                                {r.fact ? ` — ${r.fact.length > 110 ? `${r.fact.slice(0, 109)}…` : r.fact}` : ""}{" "}
                                <Link href={`/seite/${encodeURIComponent(r.pageId)}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                                  Quelle
                                </Link>
                              </li>
                            ))}
                            {g.items.length > 4 && <li>… und {g.items.length - 4} weitere</li>}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {detail.pages.length > 0 && (
                  <section className="space-y-1">
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase">Seiten ({detail.pages.length})</h3>
                    <ul className="space-y-1.5 text-sm">
                      {detail.pages.map((p) => (
                        <li key={p.id}>
                          <Link href={`/seite/${encodeURIComponent(p.id)}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                            {p.title}
                          </Link>{" "}
                          <span className="text-xs text-zinc-400">{p.space}</span>
                          {p.summary && <p className="line-clamp-2 text-xs text-zinc-500">{p.summary}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        )}
        <div className="card flex flex-wrap gap-x-3 gap-y-1 p-3 text-xs text-zinc-500">
          {all.types.map((t) => (
            <span key={t} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: styleOf(t).color }} />
              {styleOf(t).label}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
