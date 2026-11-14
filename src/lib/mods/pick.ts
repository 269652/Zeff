"use client";

import { hookIdOf } from "./hook";

/**
 * "Point at something": the user clicks a piece of the screen, and the assistant learns what "this" is — the element, its text, the
 * hooked components it is drawn by (innermost first, each with the simple values it was given: a page's id, a view's name), and the
 * data-* marks around it. The components come from React's own tree (the fiber on the DOM node) and the hooks' names (lib/mods/hook.ts:
 * every exported component is a named hook), so it works for any part of Zeff without marking anything by hand. Browser only.
 */

export type PointedComponent = { hook: string; props: Record<string, string | number | boolean> };
export type Pointed = { path: string; element: string; text: string; components: PointedComponent[]; data: Record<string, string> };

const MAX_COMPONENTS = 8;
const SKIP_PROPS = new Set(["children", "className", "style", "key", "ref", "dangerouslySetInnerHTML"]);

type Fiber = { type?: unknown; memoizedProps?: Record<string, unknown>; return?: Fiber | null };

function fiberOf(el: Element): Fiber | null {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  return key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
}

/** The simple values a component was given (numbers, short texts, yes/no) — enough to tell which page, view or row it shows. */
function simpleProps(props: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (SKIP_PROPS.has(k) || Object.keys(out).length >= 8) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= 80) out[k] = v;
  }
  return out;
}

/** The hooked components an element is drawn by, innermost first. */
export function componentsOf(el: Element): PointedComponent[] {
  const out: PointedComponent[] = [];
  const seen = new Set<string>();
  for (let f = fiberOf(el); f && out.length < MAX_COMPONENTS; f = f.return ?? null) {
    const t = f.type as { type?: unknown; render?: unknown } | undefined;
    const hook = hookIdOf(t) ?? hookIdOf(t?.type) ?? hookIdOf(t?.render);
    if (!hook || seen.has(hook)) continue;
    seen.add(hook);
    out.push({ hook, props: simpleProps(f.memoizedProps) });
  }
  return out;
}

/** What is under the pointer, as the assistant reads it. */
export function describe(el: Element): Pointed {
  const data: Record<string, string> = {};
  for (let e: Element | null = el, depth = 0; e && depth < 12 && Object.keys(data).length < 8; e = e.parentElement, depth++) {
    for (const a of Array.from(e.attributes)) if (a.name.startsWith("data-") && !(a.name in data) && a.value.length <= 80) data[a.name] = a.value;
  }
  const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "";
  const role = el.getAttribute("role");
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    path: location.pathname,
    element: `<${el.tagName.toLowerCase()}${role ? ` role="${role}"` : ""}${label ? ` "${label.slice(0, 80)}"` : ""}>`,
    text,
    components: componentsOf(el),
    data,
  };
}

/** A short name for the chip in the chat: the innermost component and the element. */
export const pointedLabel = (p: Pointed): string => {
  const c = p.components[0]?.hook.split("#")[1];
  const what = p.text ? `“${p.text.slice(0, 40)}${p.text.length > 40 ? "…" : ""}”` : p.element;
  return c ? `${c} › ${what}` : what;
};

/** What the assistant is told (part of the user's message). */
export const pointedText = (p: Pointed): string =>
  [
    `[Gezeigt: der Nutzer hat auf dem Bildschirm auf dieses Element gezeigt — „dies“ / „das“ / „hier“ meint es] (Seite ${p.path})`,
    `Element: ${p.element}${p.text ? ` mit Text „${p.text}“` : ""}`,
    p.components.length ? `Gezeichnet von (innen nach außen, Hook-Namen für workspace_mod_hooks): ${p.components.map((c) => `${c.hook}${Object.keys(c.props).length ? ` ${JSON.stringify(c.props)}` : ""}`).join(" ‹ ")}` : "",
    Object.keys(p.data).length ? `Markierungen: ${Object.entries(p.data).map(([k, v]) => `${k}=${v}`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

/**
 * Let the user point: the element under the mouse is outlined, a click takes it (and does nothing else), Escape stops. Resolves with
 * what was pointed at, or null.
 */
export function pickElement(): Promise<Pointed | null> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    Object.assign(box.style, { position: "fixed", zIndex: "2147483647", pointerEvents: "none", border: "2px solid #7c3aed", background: "rgba(124,58,237,0.08)", borderRadius: "4px", transition: "all 60ms", display: "none" });
    const tip = document.createElement("div");
    Object.assign(tip.style, { position: "fixed", zIndex: "2147483647", pointerEvents: "none", left: "50%", top: "12px", transform: "translateX(-50%)", background: "#7c3aed", color: "white", font: "12px system-ui, sans-serif", padding: "4px 10px", borderRadius: "999px" });
    tip.textContent = document.documentElement.lang === "de" ? "Zeig auf etwas und klicke — Esc bricht ab" : "Point at something and click — Esc stops";
    document.body.append(box, tip);
    const cursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    const ours = (e: Event) => e.target === box || e.target === tip;
    const move = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || ours(e)) return;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: "block", left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    };
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const finish = (out: Pointed | null) => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.removeEventListener(t, block, true);
      box.remove();
      tip.remove();
      document.documentElement.style.cursor = cursor;
      resolve(out);
    };
    const click = (e: MouseEvent) => {
      block(e);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      finish(el ? describe(el) : null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      block(e);
      finish(null);
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    // (The page doesn't react to the click that points: no button pressed, no focus moved.)
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) document.addEventListener(t, block, true);
  });
}
