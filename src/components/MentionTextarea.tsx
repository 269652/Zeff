"use client";

import { useEffect, useRef, useState } from "react";
import { searchPeopleAction } from "@/plugins/people/server-actions";
import { searchDocumentsAction, type DocHit } from "@/plugins/documents/server-actions";
import { KIND_ICONS, sizeText, type DocKind } from "@/plugins/documents/shared";
import { useT } from "@/components/I18nProvider";

type Found = { id: number; name: string; jira: string | null };

/** The @word being typed at the cursor (letters, digits, spaces inside a name up to the cursor) — or null. */
function tagAt(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && /[\p{L}\p{N}_.@]/u.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  return /^[\p{L}\p{N}_. -]{0,40}$/u.test(query) && !/\n/.test(query) && !/\s{2}/.test(query) ? { start: at, query } : null;
}

/** The picture being referenced at the cursor: ![title]( and what is typed after the paren — or null (also once it is a complete doc:12). */
function imageAt(text: string, cursor: number): { open: number; title: string; query: string } | null {
  const m = /!\[([^\]\n]*)\]\(([^)\n]*)$/.exec(text.slice(0, cursor));
  if (!m || /^doc:\d+$/.test(m[2])) return null;
  return { open: m.index, title: m[1], query: m[2] };
}

/**
 * A textarea in which @ tags people (the People plugin): typing @ and a few letters suggests them
 * — arrow keys and Enter (or a click) put @Name in. A tagged person with a linked Jira account becomes
 * a mention of them when the note is synced to Jira. With `images`, typing ![title]( opens a search of
 * the document store (pictures first): picking one writes ![title](doc:12) — the picture is then a file of
 * the todo and shown inline (and uploaded to Jira with the note). Everything else is a plain textarea.
 */
export function MentionTextarea({ value, onChange, onKeyDown, images, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void; images?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const [tag, setTag] = useState<{ start: number; query: string } | null>(null);
  const [img, setImg] = useState<{ open: number; title: string; query: string } | null>(null);
  const [docs, setDocs] = useState<DocHit[]>([]);
  useEffect(() => {
    if (!tag) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the suggestions go with the tag being typed
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const r = await searchPeopleAction(tag.query).catch(() => []);
      if (live) {
        setFound(r);
        setActive(0);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tag]);
  const imgQuery = img?.query;
  const imgOpen = img !== null;
  useEffect(() => {
    if (!imgOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the suggestions go with the picture being referenced
      setDocs([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const r = await searchDocumentsAction(imgQuery ?? "").catch(() => []);
      if (live) {
        setDocs(r);
        setActive(0);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [imgOpen, imgQuery]);
  const settle = (next: string, pos: number) => {
    onChange(next);
    setTag(null);
    setFound([]);
    setImg(null);
    setDocs([]);
    const el = ref.current;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };
  const pick = (p: Found) => {
    if (!tag) return;
    const end = ref.current?.selectionStart ?? value.length;
    settle(`${value.slice(0, tag.start)}@${p.name} ${value.slice(end)}`, tag.start + p.name.length + 2);
  };
  /** ![title](query → ![title](doc:12) (a title left empty is the document's name; a closing paren already there is used). */
  const pickDoc = (d: DocHit) => {
    if (!img) return;
    const end = ref.current?.selectionStart ?? value.length;
    const rest = value.slice(end).startsWith(")") ? value.slice(end + 1) : value.slice(end);
    const title = (img.title || d.name.replace(/\.[a-z0-9]+$/i, "")).replace(/[[\]]/g, "");
    const ref12 = `![${title}](${d.ref})`;
    settle(`${value.slice(0, img.open)}${ref12}${rest}`, img.open + ref12.length);
  };
  const list = img ? docs.length : found.length;
  const listing = (img || tag) && list > 0;
  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const at = tagAt(e.target.value, e.target.selectionStart);
          setTag(at);
          setImg(!at && images ? imageAt(e.target.value, e.target.selectionStart) : null);
        }}
        onKeyDown={(e) => {
          if (listing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : list - 1)) % list);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              if (img) pickDoc(docs[active]);
              else pick(found[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setTag(null);
              setImg(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
        onBlur={() =>
          setTimeout(() => {
            setTag(null);
            setImg(null);
          }, 150)
        }
      />
      {img && (
        <ul role="listbox" aria-label={t("Pictures and documents")} className="absolute z-20 mt-1 max-h-64 w-96 max-w-full overflow-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {docs.length === 0 && <li className="px-2 py-1.5 text-xs text-zinc-500">{t("Nothing found — paste or drop a picture into the note to add one.")}</li>}
          {docs.map((d, i) => (
            <li key={d.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${i === active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickDoc(d);
                }}
              >
                {d.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a small preview of a stored file
                  <img src={`/api/documents/${d.id}/file`} alt="" className="size-9 shrink-0 rounded border border-zinc-200 object-cover dark:border-zinc-700" />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center text-lg">{KIND_ICONS[d.kind as DocKind] ?? "📎"}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{d.name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {sizeText(d.size)}
                    {d.abstract ? ` · ${d.abstract}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!img && found.length > 0 && (
        <ul role="listbox" aria-label={t("People")} className="absolute z-20 mt-1 max-h-48 w-72 overflow-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {found.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left ${i === active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                <span className="truncate">{p.name}</span>
                <span className={`shrink-0 text-xs ${p.jira ? "font-mono text-zinc-500" : "text-amber-600 dark:text-amber-400"}`}>{p.jira ? `~${p.jira}` : t("no Jira account")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
