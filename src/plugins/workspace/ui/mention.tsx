"use client";

import { Extension } from "@tiptap/react";
import { useT } from "@/components/I18nProvider";
import type { Lang } from "@/lib/i18n/shared";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { mentionSearchAction, type MentionItem } from "../actions";
import { suggestionRender, type MenuProps } from "./popup";

export function MentionMenu({ items, selected, onPick, onHover }: MenuProps<MentionItem>) {
  const t = useT();
  const KIND_LABEL: Record<MentionItem["kind"], string> = { metric: t("Metrics"), page: t("Pages"), person: t("People"), todo: t("Todos"), ticket: t("Tickets") };
  if (!items.length) return <div className="px-2 py-1.5 text-zinc-500">{t("Type a name, a page, a todo or a ticket key")}</div>;
  return (
    <>
      {items.map((it, i) => {
        const head = it.kind !== items[i - 1]?.kind ? KIND_LABEL[it.kind] : null;
        return (
          <div key={`${it.kind}:${it.ref}`}>
            {head && <div className="ws-pop-head">{head}</div>}
            <button type="button" role="option" aria-selected={i === selected} onClick={() => onPick(i)} onMouseEnter={() => onHover(i)}>
              <span className="ws-pop-icon">{it.icon}</span>
              <span className="min-w-0">
                <span className="block truncate">{it.label}</span>
                <span className="block truncate text-xs text-zinc-500">{it.hint}</span>
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}

/** "@" opens the people / pages / todos / tickets menu; the pick becomes a chip that links to it. */
export const MentionCommand = Extension.create<{ getLang: () => Lang }>({
  name: "mentionCommand",
  addOptions() {
    return { getLang: () => "en" as Lang };
  },
  addProseMirrorPlugins() {
    const getLang = this.options.getLang;
    return [
      Suggestion<MentionItem, MentionItem>({
        pluginKey: new PluginKey("mentionSuggestion"),
        editor: this.editor,
        char: "@",
        allowSpaces: true,
        // (also after what a formula has before a name: =, +, ;, & …)
        allowedPrefixes: [" ", "\n", "(", "=", "+", "-", "*", "/", ";", ",", "&", "<", ">"],
        items: async ({ query }) => mentionSearchAction(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [{ type: "zeffRef", attrs: { kind: props.kind, ref: props.ref, label: props.label, href: props.href } }, { type: "text", text: " " }])
            .run();
        },
        render: suggestionRender<MentionItem>(MentionMenu, getLang),
      }),
    ];
  },
});
