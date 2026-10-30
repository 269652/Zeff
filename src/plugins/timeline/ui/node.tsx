"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useT } from "@/components/I18nProvider";
import { GripBar } from "@/plugins/workspace/ui/app-nodes";
import { TimelineList } from "./TimelineList";

/**
 * The timeline as a block of a page: the page's own (a row's — the person or case it stands for, the ticket it names), or an entity's
 * given by `ref` (person:12, ticket:PROJ-7, a name), or everything ("all"). Read when the page is shown, never stored in it.
 */
function TimelineBlock(p: NodeViewProps) {
  const t = useT();
  const pageId = Number((p.extension.options as { pageId: number }).pageId);
  const ref = String(p.node.attrs.ref ?? "").trim();
  const limit = Number(p.node.attrs.limit) || 20;
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="timeline">
      <GripBar editor={p.editor} node={p.node} getPos={p.getPos} deleteNode={p.deleteNode} label={t("Timeline")} />
      <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t("Timeline")}</h4>
          {p.editor.isEditable && (
            <input
              className="ml-auto w-48 rounded border border-transparent bg-transparent px-1 text-xs text-zinc-500 hover:border-zinc-200 focus:border-zinc-300 dark:hover:border-zinc-700"
              defaultValue={ref}
              placeholder={t("this page's — or a name, ref, “all”")}
              aria-label={t("Whose timeline")}
              onBlur={(e) => e.target.value.trim() !== ref && p.updateAttributes({ ref: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          )}
        </div>
        {ref === "all" ? <TimelineList limit={limit} compact /> : ref ? <TimelineList key={ref} entity={ref} limit={limit} compact /> : pageId ? <TimelineList row={pageId} limit={limit} compact /> : <p className="text-sm text-zinc-400">…</p>}
      </section>
    </NodeViewWrapper>
  );
}

export const ZeffTimeline = Node.create<{ pageId: number }>({
  name: "zeffTimeline",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { ref: { default: "" }, limit: { default: 20 } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-timeline]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-timeline": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TimelineBlock as never);
  },
});
