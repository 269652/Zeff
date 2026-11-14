"use client";

import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useCallback, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { saveBlockAction } from "../actions";
import type { TplError } from "../view-template";
import { BlockCode } from "./block-code";
import { WS_CHANGED } from "./ChatPanel";
import { GripBar } from "./app-nodes";
import { useBlockActions } from "./block-toolbar";
import { PageBlock } from "./page-block";
import { useBlockDefs } from "./use-blocks";

/**
 * A block of your own as a block of a page (doc.ts: zeffBlock — `:::use name {params}` in Markdown): picked from your blocks when the
 * page is edited, its parameters set under ⚙, drawn by PageBlock.
 */

const parse = (s: unknown): Record<string, string> => {
  try {
    const v = JSON.parse(String(s ?? "{}")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
};

function PageBlockView({ node, updateAttributes, editor, extension, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const defs = useBlockDefs();
  const name = String(node.attrs.block ?? "");
  const params = useMemo(() => parse(node.attrs.params), [node.attrs.params]);
  const def = defs?.find((d) => d.name === name);
  const [open, setOpen] = useState(false);
  const setParam = (key: string, value: string) => updateAttributes({ params: JSON.stringify({ ...params, [key]: value }) });
  const pageId = Number((extension.options as { pageId: number }).pageId);
  // Its code (the </> of its bar): the block's template, shown under it; the block draws what is typed until it is saved or left.
  const [code, setCode] = useState<string | null>(null);
  const [codeErrors, setCodeErrors] = useState<TplError[]>([]);
  const onCodeErrors = useCallback((e: TplError[]) => setCodeErrors(e), []);
  const draft = useMemo(() => (def && code !== null && code !== def.template ? { ...def, template: code } : undefined), [def, code]);
  const uses = useMemo(() => (def && !def.widget ? def : null), [def]);
  // The block's bar (over it on hover, or when picked): </> its template (the code panel links the Studio), ⚙ which block this is
  // and its parameters. Until one is picked the picker shows right here.
  // </> its template right here (a block made of the view language; a widget block's code is in the Studio).
  const blockActions = useBlockActions(
    name
      ? {
          ...(uses ? { code: () => setCode((c) => (c === null ? uses.template : null)) } : {}),
          settings: () => setOpen((o) => !o),
        }
      : {},
  );
  return (
    <NodeViewWrapper className="ws-module-block my-2" contentEditable={false} data-code-open={code !== null || undefined} {...blockActions}>
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={def?.title || name || t("Block")} />
      {editor.isEditable && (!name || open) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
          <select className="input w-auto py-0.5 text-xs" value={name} aria-label={t("Block")} onChange={(e) => updateAttributes({ block: e.target.value, params: "{}" })}>
            <option value="">{t("Pick a block …")}</option>
            {(defs ?? []).map((d) => (
              <option key={d.name} value={d.name}>
                {d.icon ? `${d.icon} ` : ""}
                {d.title || d.name}
              </option>
            ))}
          </select>
          {name && (
            <button type="button" className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setOpen(false)}>
              {t("Done")}
            </button>
          )}
        </div>
      )}
      {open && def && def.params.length > 0 && (
        <div className="mb-2 grid gap-2 rounded-lg border border-zinc-200 p-2 text-xs sm:grid-cols-2 dark:border-zinc-800">
          {def.params.map((p) => (
            <label key={p.name} className="space-y-0.5">
              <span className="block text-zinc-500">
                {p.name}
                {p.required ? " *" : ""}
                {p.help ? ` — ${p.help}` : ""}
              </span>
              {/* Its choices (options) as a list, yes/no as a box — set at once; a text or a number when you leave the field. */}
              {p.options?.length ? (
                <select className="input w-full py-1 text-xs" value={params[p.name] ?? p.default ?? ""} onChange={(e) => setParam(p.name, e.target.value)}>
                  {!p.required && !p.default && <option value="">—</option>}
                  {p.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : p.type === "boolean" ? (
                <input type="checkbox" className="block size-4" checked={(params[p.name] ?? p.default ?? "") === "true"} onChange={(e) => setParam(p.name, e.target.checked ? "true" : "false")} />
              ) : (
                <input
                  key={params[p.name] ?? ""}
                  className="input w-full py-1 text-xs"
                  type={p.type === "number" ? "number" : "text"}
                  defaultValue={params[p.name] ?? ""}
                  placeholder={p.default ?? p.type}
                  onBlur={(e) => e.target.value !== (params[p.name] ?? "") && setParam(p.name, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              )}
            </label>
          ))}
        </div>
      )}
      {name ? <PageBlock block={name} params={params} pageId={pageId} title={def?.title} draft={draft} onErrors={code !== null ? onCodeErrors : undefined} /> : !editor.isEditable && <p className="text-sm text-zinc-400">{t("No block picked.")}</p>}
      {code !== null && uses && editor.isEditable && (
        <BlockCode
          title={`${uses.icon ? `${uses.icon} ` : ""}${uses.title || uses.name}`}
          value={code}
          saved={uses.template}
          onChange={setCode}
          errors={codeErrors}
          scope={t("The block “{name}” — saving changes it on every page that uses it (each version is kept)", { name: uses.title || uses.name })}
          onClose={() => setCode(null)}
          onSave={async (template) => {
            const r = await saveBlockAction({ ...uses, template });
            if (!r.ok) return r.error;
            // (the blocks are read again everywhere — this one draws the saved template)
            window.dispatchEvent(new Event(WS_CHANGED));
            return null;
          }}
          extra={
            <a className="rounded px-2 py-0.5 text-zinc-500 no-underline hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-700" href={`/studio?block=${encodeURIComponent(uses.name)}`} target="_blank" rel="noopener">
              {t("Studio")} ↗
            </a>
          }
        />
      )}
    </NodeViewWrapper>
  );
}

export const ZeffBlockNode = Node.create<{ pageId: number }>({
  name: "zeffBlock",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { block: { default: "" }, params: { default: "{}" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-block": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageBlockView);
  },
});
