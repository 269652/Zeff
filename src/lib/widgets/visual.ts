/**
 * The visual editor's model (client only): a widget's markup as a tree you can change — text, attributes, styles, order, groups —
 * without touching its scripts. The widget's HTML is parsed like the frame does (a fragment in <body>); every <script> is lifted out
 * (a comment marks its place) and put back as it was when the markup is written again. So what a script builds at run time isn't
 * part of the model (it shows as an empty box) and nothing a script does is baked into the code. Every change can be undone.
 */

export type OutlineNode = { zid: string; tag: string; label: string; leaf: boolean; children: OutlineNode[] };
export type DropAt = "before" | "after" | "inside";

const SCRIPT_MARK = /<!--zeff-script:(\d+)-->/g;
const SEP = String.fromCharCode(0);
const MAX_UNDO = 100;
/** Things that can be put into the widget (the palette). */
export const NEW_ELEMENTS: { kind: string; label: string; html: string }[] = [
  { kind: "text", label: "Text", html: "<p>Text</p>" },
  { kind: "heading", label: "Heading", html: "<h2>Heading</h2>" },
  { kind: "button", label: "Button", html: '<button type="button">Button</button>' },
  { kind: "input", label: "Input", html: '<input type="text" placeholder="…">' },
  { kind: "row", label: "Row", html: '<div style="display:flex;gap:8px;align-items:center"></div>' },
  { kind: "column", label: "Column", html: '<div style="display:flex;flex-direction:column;gap:8px"></div>' },
  { kind: "grid", label: "Grid", html: '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px"></div>' },
  { kind: "box", label: "Box", html: '<div style="padding:12px;border:1px solid #d4d4d8;border-radius:8px"></div>' },
];

export class VisualModel {
  readonly doc: Document;
  private scripts: string[] = [];
  private counter = 0;
  /** Changes with every edit (what draws it draws again). */
  version = 0;
  private listeners = new Set<() => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** The body as it is after the last change — what the next change keeps for undo. */
  private last: string;

  constructor(html: string) {
    this.doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, "text/html");
    for (const s of [...this.doc.querySelectorAll("script")]) {
      s.replaceWith(this.doc.createComment(`zeff-script:${this.scripts.push(s.outerHTML) - 1}`));
    }
    this.mark(this.doc.body);
    this.last = this.doc.body.innerHTML;
  }

  get body(): HTMLElement {
    return this.doc.body;
  }
  get hasScripts(): boolean {
    return this.scripts.length > 0;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private notify() {
    this.version++;
    for (const l of this.listeners) l();
  }
  /** A change made: the state before it is kept for undo, what could be redone is gone. */
  private changed() {
    this.undoStack.push(this.last);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.last = this.doc.body.innerHTML;
    this.notify();
  }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.last);
    this.doc.body.innerHTML = prev;
    this.last = prev;
    this.notify();
    return true;
  }
  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.last);
    this.doc.body.innerHTML = next;
    this.last = next;
    this.notify();
    return true;
  }
  /** The canvas draws again (an edit given up). */
  refresh() {
    this.notify();
  }

  private next(): string {
    return `z${++this.counter}`;
  }
  private mark(root: Element) {
    for (const el of root.querySelectorAll("*")) if (!el.hasAttribute("data-zid")) el.setAttribute("data-zid", this.next());
  }
  el(zid: string | null): HTMLElement | null {
    if (zid === "body") return this.doc.body;
    return zid ? (this.doc.body.querySelector(`[data-zid="${zid.replace(/[^a-z0-9]/gi, "")}"]`) as HTMLElement | null) : null;
  }

  /** The tree for the outline (the markup's elements; <style> and the like stay out of the way). */
  outline(): OutlineNode[] {
    const walk = (parent: Element): OutlineNode[] =>
      [...parent.children].flatMap((c): OutlineNode[] => {
        const tag = c.tagName.toLowerCase();
        if (tag === "style" || tag === "link" || tag === "meta") return [];
        const leaf = c.children.length === 0;
        const text = leaf ? (c.textContent ?? "").trim().slice(0, 28) : "";
        const id = c.id ? `#${c.id}` : "";
        const cls = !id && c.classList.length ? `.${c.classList[0]}` : "";
        const grp = c.hasAttribute("data-group") ? "⛓ " : "";
        return [{ zid: c.getAttribute("data-zid") ?? "", tag, label: `${grp}${tag}${id}${cls}${text ? ` “${text}”` : ""}`, leaf, children: walk(c) }];
      });
    return walk(this.doc.body);
  }

  /** The markup as drawn in the editing view: no script, no event handler, no javascript: link — what it holds can't run there. */
  canvasHtml(): string {
    const c = this.doc.body.cloneNode(true) as HTMLElement;
    for (const el of [...c.querySelectorAll("*")]) {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || (/^(href|src|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      }
      if (el.tagName === "SCRIPT") el.remove();
    }
    const walker = this.doc.createTreeWalker(c, NodeFilter.SHOW_COMMENT);
    const marks: Comment[] = [];
    while (walker.nextNode()) marks.push(walker.currentNode as Comment);
    for (const m of marks) m.remove();
    return c.innerHTML;
  }

  /** The widget's HTML again: the edited markup with every script where it was. */
  html(): string {
    const c = this.doc.body.cloneNode(true) as HTMLElement;
    for (const el of [c, ...c.querySelectorAll("*")]) el.removeAttribute("data-zid");
    return c.innerHTML.replace(SCRIPT_MARK, (_m, i: string) => this.scripts[Number(i)] ?? "").trim();
  }

  /** Whether the element is only text (nothing but text inside). */
  isLeaf(zid: string): boolean {
    const e = this.el(zid);
    return !!e && e.children.length === 0;
  }
  /** Whether there is text of its own to write in: a leaf, or text beside its elements ("Rate: <b></b>"). */
  hasText(zid: string): boolean {
    const e = this.el(zid);
    if (!e) return false;
    if (e.children.length === 0) return true;
    return [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
  }
  setText(zid: string, text: string) {
    const e = this.el(zid);
    if (!e || e.children.length) return;
    if ((e.textContent ?? "") === text) return;
    e.textContent = text;
    this.changed();
  }
  /** Its own text pieces written again (what was typed in place): one for one; if the count changed they go into the first. */
  setOwnText(zid: string, texts: string[]) {
    const e = this.el(zid);
    if (!e) return;
    const mine = [...e.childNodes].filter((n) => n.nodeType === 3);
    if (texts.join(SEP) === mine.map((n) => n.textContent ?? "").join(SEP)) return this.notify();
    if (mine.length === texts.length) mine.forEach((n, i) => (n.textContent = texts[i]));
    else if (mine.length) {
      mine[0].textContent = texts.join("");
      for (const n of mine.slice(1)) n.remove();
    } else e.appendChild(this.doc.createTextNode(texts.join("")));
    this.changed();
  }

  attrs(zid: string): { name: string; value: string }[] {
    const e = this.el(zid);
    return e ? [...e.attributes].filter((a) => a.name !== "data-zid" && a.name !== "style").map((a) => ({ name: a.name, value: a.value })) : [];
  }
  setAttr(zid: string, name: string, value: string | null) {
    const e = this.el(zid);
    if (!e || !/^[a-z][a-z0-9_:-]*$/i.test(name) || name === "data-zid" || /^on/i.test(name)) return;
    if (value === null) e.removeAttribute(name);
    else e.setAttribute(name, value);
    this.changed();
  }
  style(zid: string, prop: string): string {
    return this.el(zid)?.style.getPropertyValue(prop) ?? "";
  }
  setStyle(zid: string, prop: string, value: string) {
    const e = this.el(zid);
    if (!e) return;
    if (value.trim()) e.style.setProperty(prop, value.trim());
    else e.style.removeProperty(prop);
    if (!e.getAttribute("style")) e.removeAttribute("style");
    this.changed();
  }

  /** Whether `zid` may be put at `target` (not onto itself or into what it holds). */
  canMove(zid: string, target: string, at: DropAt): boolean {
    const e = this.el(zid);
    const t = this.el(target);
    if (!e || !t || e === t || e.contains(t)) return false;
    if (at !== "inside" && t === this.doc.body) return false;
    return true;
  }
  move(zid: string, target: string, at: DropAt) {
    if (!this.canMove(zid, target, at)) return;
    const e = this.el(zid)!;
    const t = this.el(target)!;
    if (at === "inside") t.appendChild(e);
    else if (at === "before") t.parentNode?.insertBefore(e, t);
    else t.parentNode?.insertBefore(e, t.nextSibling);
    this.changed();
  }
  remove(zid: string) {
    const e = this.el(zid);
    if (!e || e === this.doc.body) return;
    e.remove();
    this.changed();
  }
  duplicate(zid: string): string | null {
    const e = this.el(zid);
    if (!e || !e.parentNode) return null;
    const c = e.cloneNode(true) as HTMLElement;
    for (const x of [c, ...c.querySelectorAll("*")]) x.removeAttribute("data-zid");
    e.parentNode.insertBefore(c, e.nextSibling);
    c.setAttribute("data-zid", this.next());
    this.mark(c);
    this.changed();
    return c.getAttribute("data-zid");
  }
  wrap(zid: string): string | null {
    return this.group([zid], false);
  }

  /**
   * Several elements together: one box they move as one. As a group (data-group, the default) a drag on any of its parts carries
   * all of them; a plain box (asGroup false) is just a wrapper. Its zid.
   */
  group(zids: string[], asGroup = true): string | null {
    let els = [...new Set(zids)].map((z) => this.el(z)).filter((e): e is HTMLElement => !!e && e !== this.doc.body);
    // (One inside another that is also in: the outer one carries it.)
    els = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
    if (!els.length) return null;
    els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const w = this.doc.createElement("div");
    if (asGroup) w.setAttribute("data-group", "");
    w.setAttribute("data-zid", this.next());
    els[0].parentNode?.insertBefore(w, els[0]);
    for (const e of els) w.appendChild(e);
    this.changed();
    return w.getAttribute("data-zid");
  }
  isGroup(zid: string): boolean {
    return !!this.el(zid)?.hasAttribute("data-group");
  }
  /** A group dissolved: what was in it stays where it was. Returns the first of them. */
  ungroup(zid: string): string | null {
    const g = this.el(zid);
    if (!g || !g.hasAttribute("data-group") || !g.parentNode) return null;
    const kids = [...g.children];
    for (const k of kids) g.parentNode.insertBefore(k, g);
    g.remove();
    this.changed();
    return kids[0]?.getAttribute("data-zid") ?? null;
  }
  /** The outermost group `zid` is in (or is) — what moves when it is dragged — else itself. */
  groupRoot(zid: string): string {
    let root: Element | null = null;
    for (let e: Element | null = this.el(zid); e && e !== this.doc.body; e = e.parentElement) if (e.hasAttribute("data-group")) root = e;
    return root?.getAttribute("data-zid") ?? zid;
  }

  /** A new element from the palette, put at `target` (none: at the end). Its zid. */
  insert(kind: string, target: string | null, at: DropAt): string | null {
    const spec = NEW_ELEMENTS.find((n) => n.kind === kind);
    if (!spec) return null;
    const tpl = this.doc.createElement("template");
    tpl.innerHTML = spec.html;
    const n = tpl.content.firstElementChild as HTMLElement | null;
    if (!n) return null;
    const t = target ? this.el(target) : this.doc.body;
    if (!t) return null;
    if (at === "inside" || t === this.doc.body) t.appendChild(n);
    else if (at === "before") t.parentNode?.insertBefore(n, t);
    else t.parentNode?.insertBefore(n, t.nextSibling);
    n.setAttribute("data-zid", this.next());
    this.mark(n);
    this.changed();
    return n.getAttribute("data-zid");
  }
  /** One step up or down among its siblings. */
  nudge(zid: string, dir: -1 | 1) {
    const e = this.el(zid);
    if (!e) return;
    const sib = dir < 0 ? e.previousElementSibling : e.nextElementSibling;
    if (!sib) return;
    if (dir < 0) e.parentNode?.insertBefore(e, sib);
    else e.parentNode?.insertBefore(sib, e);
    this.changed();
  }
}
