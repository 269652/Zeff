"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18nProvider";

/** Small building blocks of the Workspace plugin's UI: a dialog, a dropdown, an emoji picker. */

/** Calls `fn` on a click outside `ref` or on Escape — while `active`. */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, active: boolean, fn: () => void) {
  const cb = useRef(fn);
  useEffect(() => {
    cb.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [active, ref]);
}

/** A dialog over the page: a backdrop, Escape and a click outside close it. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, true, onClose);
  useEffect(() => {
    box.current?.focus();
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh]">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} space-y-3 p-4 shadow-xl outline-none`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A button with a dropdown under it (any content); closes on a click outside, Escape, a scroll or when `close` is called.
 * The menu is a portal to the body (fixed under the button): inside a sidebar or a table it would be cut off or make it scroll.
 */
export function Dropdown({ label, children, align = "left", title, className = "btn btn-sm", wrapClassName = "relative inline-block" }: { label: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; title?: string; className?: string; /** The box around the button (a split button's half: "relative flex", so it is as high as the other half). */ wrapClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const cb = useRef(close);
  useEffect(() => {
    cb.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      setAt({ top: r.bottom + 4, ...(align === "right" ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, Math.min(r.left, window.innerWidth - 200)) }) });
    };
    place();
    const down = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!menu.current?.contains(n) && !button.current?.contains(n)) cb.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    // A scroll elsewhere (the sidebar, the page) moves the button: the menu goes with it - closed is simplest.
    const scroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, align]);
  return (
    <div className={wrapClassName}>
      <button ref={button} type="button" className={className} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open &&
        at &&
        typeof document !== "undefined" &&
        createPortal(
          // (A click inside must not reach a dialog's own "click outside closes it" - the menu is outside of it in the DOM.)
          <div
            ref={menu}
            style={{ position: "fixed", top: at.top, left: at.left, right: at.right }}
            onMouseDown={(e) => e.stopPropagation()}
            className="z-[80] max-h-[70vh] min-w-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            role="menu"
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * Drag and drop to put things in order: `handle(id)` goes on what is picked up, `target(id)` on what it can be dropped on
 * (often the same element); `mark(id)` is a class that shows where it would land (before or after, by `axis`).
 * `onMove(from, to, after)` does the move.
 */
export function useSortable(onMove: (from: string, to: string, after: boolean) => void, axis: "x" | "y" = "y", mime = "text/ws-sort") {
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const handle = (id: string) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(mime, id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => setOver(null),
  });
  const target = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(mime)) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = axis === "x" ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      setOver((o) => (o && o.id === id && o.after === after ? o : { id, after }));
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.id === id ? null : o));
    },
    onDrop: (e: React.DragEvent) => {
      const from = e.dataTransfer.getData(mime);
      if (!from) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = axis === "x" ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      setOver(null);
      onMove(from, id, after);
    },
  });
  const mark = (id: string): string => (over?.id !== id ? "" : axis === "x" ? (over.after ? "shadow-[inset_-3px_0_0_0_#6366f1]" : "shadow-[inset_3px_0_0_0_#6366f1]") : over.after ? "shadow-[inset_0_-3px_0_0_#6366f1]" : "shadow-[inset_0_3px_0_0_#6366f1]");
  return { handle, target, mark };
}

/** A row of a dropdown. */
export function MenuItem({ onClick, children, danger = false, disabled = false, checked }: { onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean; checked?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${danger ? "text-red-600 dark:text-red-400" : ""}`}>
      {checked !== undefined && <span className="w-4 text-center text-xs">{checked ? "✓" : ""}</span>}
      {children}
    </button>
  );
}

const EMOJI = [
  "📄", "📘", "📗", "📙", "📕", "📓", "📝", "🗒️", "🗂️", "📁", "📌", "📎", "🔖", "💡", "🎯", "🚀", "✅", "☑️", "⭐", "🔥", "⚡", "🧠", "🧩", "🛠️", "⚙️", "🔧", "🧪", "🔬", "📊", "📈", "📉", "💼", "🏷️", "🗓️", "📅", "⏰", "🕐", "🤝", "👥", "👤", "💬", "📣", "📢", "✉️", "📨", "🔒", "🔑", "🌍", "🏠", "🏢", "🛒", "💰", "🧾", "📚", "📖", "🎓", "🎨", "🖼️", "🎬", "🎵", "🎮", "⚽", "🌱", "🌳", "☀️", "🌙", "❤️", "💜", "💙", "💚", "🟢", "🟡", "🔴", "🔵", "⚠️", "❗", "❓", "ℹ️", "✨", "🎉", "🐛", "🔍", "🔗", "📦", "🧰", "🗑️",
];

/** Pick an emoji (a grid), or type one; "Remove" clears. */
export function EmojiPicker({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: ReactNode }) {
  const t = useT();
  const [text, setText] = useState("");
  return (
    <Dropdown label={children} className="rounded-md px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
      {(close) => (
        <div className="w-72 space-y-2 p-1">
          <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className="rounded p-1 text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => {
                  onChange(e);
                  close();
                }}
              >
                {e}
              </button>
            ))}
          </div>
          <form
            className="flex gap-1"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (text.trim()) {
                onChange([...text.trim()].slice(0, 2).join(""));
                close();
              }
            }}
          >
            <input className="input flex-1" value={text} onChange={(ev) => setText(ev.target.value)} placeholder={t("Type an emoji …")} aria-label={t("Emoji")} />
            {value && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  onChange("");
                  close();
                }}
              >
                {t("Remove")}
              </button>
            )}
          </form>
        </div>
      )}
    </Dropdown>
  );
}

/** The gradients a page's cover can be (kept as "gradient:<key>"). */
export const COVERS: Record<string, string> = {
  dawn: "linear-gradient(120deg, #fbc2eb 0%, #a6c1ee 100%)",
  ocean: "linear-gradient(120deg, #89f7fe 0%, #66a6ff 100%)",
  forest: "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  sunset: "linear-gradient(120deg, #f6d365 0%, #fda085 100%)",
  night: "linear-gradient(120deg, #434343 0%, #000000 100%)",
  violet: "linear-gradient(120deg, #a18cd1 0%, #fbc2eb 100%)",
  sand: "linear-gradient(120deg, #e6dccd 0%, #f5efe6 100%)",
  steel: "linear-gradient(120deg, #cfd9df 0%, #e2ebf0 100%)",
};

export const coverStyle = (cover: string): React.CSSProperties | undefined => (cover.startsWith("gradient:") ? { backgroundImage: COVERS[cover.slice(9)] ?? COVERS.dawn } : cover ? { backgroundImage: `url("${cover.replace(/"/g, "%22")}")` } : undefined);

/** Upload a picture for a page; returns its URL, or throws with what went wrong. */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/workspace/files", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body.url;
}

/** Ask for a picture file with the system's picker. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
