"use client";

import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type Editor as TiptapEditor, type JSONContent, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { createContext, lazy, Suspense, useContext, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { pageEmbedAction } from "../actions";
import { DatabaseBlock } from "./DatabaseView";

/**
 * Another page shown in this one (an inline page): its content as a block — written in place (it's that page's editor,
 * saving to that page), its sub-pages below; a database as its view. A page link (chip) becomes one, and back. Pages in
 * pages go two deep (deeper, or the page itself: a link).
 */

// (Lazy: the editor holds this block — the other way round would be a loop of imports.)
const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));

const Depth = createContext(0);
const MAX_DEPTH = 2;

type Embedded = { kind: "page" | "database"; title: string; icon: string; content: string; rev: number; children: { id: number; title: string; icon: string; kind: "page" | "database" }[] };

/** A page chip as an inline page (replacing its line when the chip is all there is on it), or an inline page back as a chip. */
export function embedPage(editor: TiptapEditor, pos: number, page: { id: number; title: string }): void {
  const $pos = editor.state.doc.resolve(pos);
  const para = $pos.parent;
  const block = { type: "pageEmbed", attrs: { pageId: page.id, title: page.title } };
  if (para.type.name === "paragraph" && para.childCount === 1) {
    editor.chain().insertContentAt({ from: $pos.before(), to: $pos.after() }, block).run();
    return;
  }
  const after = $pos.after();
  editor.chain().insertContentAt(after, block).deleteRange({ from: pos, to: pos + 1 }).run();
}

function PageEmbedView({ node, editor, getPos, extension }: NodeViewProps) {
  const t = useT();
  const pageId = Number(node.attrs.pageId);
  const depth = useContext(Depth);
  const self = Number((extension.options as { pageId: number }).pageId) === pageId;
  const [page, setPage] = useState<Embedded | null | "gone">(null);
  useEffect(() => {
    let live = true;
    void pageEmbedAction(pageId).then((r) => live && setPage(r.ok ? r.page : "gone"));
    return () => {
      live = false;
    };
  }, [pageId]);
  const title = page && page !== "gone" ? page.title || t("Untitled") : String(node.attrs.title || t("Untitled"));
  const asLink = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos === null || pos === undefined) return;
    editor
      .chain()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "paragraph", content: [{ type: "zeffRef", attrs: { kind: "page", ref: String(pageId), label: title, href: `/workspace/${pageId}` } }] })
      .run();
  };
  const body = () => {
    if (page === null) return <p className="text-sm text-zinc-400">…</p>;
    if (page === "gone") return <p className="text-sm text-zinc-400">{t("This page is gone.")}</p>;
    if (page.kind === "database") return <DatabaseBlock dbId={pageId} viewId="" onView={() => {}} />;
    if (self || depth >= MAX_DEPTH) return null;
    return (
      <Depth.Provider value={depth + 1}>
        {/* Its own editor: keys and pastes stay in it (not the page around). */}
        <div className="ws-embed-editor" onKeyDown={(e) => e.stopPropagation()} onPaste={(e) => e.stopPropagation()} onDrop={(e) => e.stopPropagation()}>
          <Suspense fallback={<p className="text-sm text-zinc-400">…</p>}>
            <Editor key={pageId} pageId={pageId} initial={JSON.parse(page.content) as JSONContent} rev={page.rev} editable={editor.isEditable} smallText={false} />
          </Suspense>
        </div>
        {page.children.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
            {page.children.map((c) => (
              <li key={c.id}>
                <Link href={`/workspace/${c.id}`} className="hover:underline">
                  {c.icon || (c.kind === "database" ? "🗂" : "📄")} {c.title || t("Untitled")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Depth.Provider>
    );
  };
  return (
    <NodeViewWrapper className="ws-embed my-2 rounded-lg border border-zinc-200 dark:border-zinc-800" contentEditable={false} data-page-embed={pageId}>
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-sm dark:border-zinc-800" data-drag-handle>
        <Link href={`/workspace/${pageId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
          {(page && page !== "gone" && page.icon) || "📄"} {title}
        </Link>
        {editor.isEditable && (
          <button type="button" className="icon-btn text-xs" title={t("Show as a link")} aria-label={t("Show as a link")} onClick={asLink}>
            ⤡
          </button>
        )}
      </div>
      <div className="px-3 py-2">{body()}</div>
    </NodeViewWrapper>
  );
}

export const PageEmbedNode = Node.create<{ pageId: number }>({
  name: "pageEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { pageId: { default: 0 }, title: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-page-embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-embed": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageEmbedView);
  },
});
