"use client";

import { mergeAttributes, Node, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useT } from "@/components/I18nProvider";
import { Inline } from "./inline-edit";

/**
 * A panel: a card with a title (and a description under it) that holds any blocks — widgets, tables, text. The container
 * "Wrap" offers (wrap-menu.tsx); it folds in and out by its chevron. In Markdown: `:::panel {"title":"…","desc":"…"}` … `:::`.
 */

function PanelView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useT();
  const title = String(node.attrs.title ?? "");
  const desc = String(node.attrs.desc ?? "");
  const collapsed = node.attrs.collapsed === true;
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="ws-panel my-2 rounded-xl border border-zinc-200 bg-zinc-50/60 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/40" data-collapsed={collapsed || undefined}>
      <div className="flex items-start gap-2 px-3 py-2.5" contentEditable={false}>
        <button
          type="button"
          className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-500/10 hover:text-zinc-700 dark:hover:text-zinc-200"
          aria-expanded={!collapsed}
          title={collapsed ? t("Open the panel") : t("Fold the panel")}
          aria-label={collapsed ? t("Open the panel") : t("Fold the panel")}
          onClick={() => updateAttributes({ collapsed: !collapsed })}
        >
          <span className={`inline-block transition-transform ${collapsed ? "" : "rotate-90"}`} aria-hidden>
            ▸
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="leading-6">
            <Inline value={title} onCommit={(v) => updateAttributes({ title: v })} label={t("Title of the panel")} placeholder={t("Title of the panel")} readOnly={!editable} className="text-sm font-semibold text-zinc-800 dark:text-zinc-100" />
          </div>
          {(desc || editable) && (
            <div className="text-xs leading-5 text-zinc-500">
              <Inline value={desc} onCommit={(v) => updateAttributes({ desc: v })} label={t("Description of the panel")} placeholder={t("Description (optional)")} readOnly={!editable} />
            </div>
          )}
        </div>
      </div>
      <NodeViewContent className={collapsed ? "hidden" : "ws-panel-body space-y-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-700"} />
    </NodeViewWrapper>
  );
}

export const PanelNode = Node.create({
  name: "panel",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { title: { default: "" }, desc: { default: "" }, collapsed: { default: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-panel]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-panel": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PanelView);
  },
});
