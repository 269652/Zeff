"use client";

import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { wrapPlanAction } from "../actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { Container } from "../wrap-plan";
import { Dropdown, MenuItem, MenuSection } from "./kit";
import { containerAt, rangeBlocks, unwrapAt, wrapBlocks, wrapRange, type Handle } from "./wrap";

/**
 * "Wrap" on a block's handle: put the block (or the blocks selected) in a panel, a box, a toggle, columns or tabs — by a choice, or
 * by a sentence the AI sets up ("both side by side in a card called Revenue") — and "Unwrap" to take them out again.
 */
export function WrapMenu({ editor, getHandle }: { editor: Editor; getHandle: () => Handle }) {
  const t = useT();
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const choices: { key: Container; icon: string; label: string }[] = [
    { key: "panel", icon: "🗂", label: t("Panel") },
    { key: "callout", icon: "💬", label: t("Info box") },
    { key: "toggle", icon: "▸", label: t("Toggle") },
    { key: "columns", icon: "▥", label: t("Columns") },
    { key: "tabs", icon: "🗒", label: t("Tabs") },
  ];
  return (
    <Dropdown label="⧉" title={t("Wrap in a container, or unwrap")} ariaLabel={t("Wrap in a container, or unwrap")} className="flex h-full w-full items-center justify-center" wrapClassName="relative flex">
      {(close) => {
        const handle = getHandle();
        const range = wrapRange(editor, handle);
        const container = containerAt(editor, handle);
        const wrap = (key: Container) => {
          if (!range || !wrapBlocks(editor, t, range, { container: key })) toast(t("That could not be wrapped here."), { tone: "error" });
          close();
        };
        const ask = async () => {
          if (!range) return;
          setBusy(true);
          const r = await wrapPlanAction(wish, rangeBlocks(range));
          setBusy(false);
          if (!r.ok) return toast(r.error, { tone: "error" });
          // (The page may have changed while the AI thought: the range is taken again.)
          const now = wrapRange(editor, getHandle()) ?? range;
          if (!wrapBlocks(editor, t, now, r.plan)) toast(t("That could not be wrapped here."), { tone: "error" });
          setWish("");
          close();
        };
        return (
          <div className="w-64">
            <MenuSection title={t("Wrap in")}>
              {choices.map((c) => (
                <MenuItem key={c.key} disabled={!range} onClick={() => wrap(c.key)}>
                  <span aria-hidden className="w-5 text-center">
                    {c.icon}
                  </span>
                  {c.label}
                </MenuItem>
              ))}
              <div className="flex items-center gap-1 px-1 pt-1">
                <input
                  value={wish}
                  onChange={(e) => setWish(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && wish.trim() && !busy) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                  placeholder={t("Or say it: side by side in a card")}
                  aria-label={t("Describe the container")}
                  className="input h-7 min-w-0 flex-1 py-0 text-xs"
                />
                <button type="button" className="btn btn-sm h-7" disabled={busy || !wish.trim() || !range} onClick={() => void ask()} title={t("The AI sets the container up from your sentence")}>
                  {busy ? "…" : "✨"}
                </button>
              </div>
            </MenuSection>
            <MenuSection title={t("Unwrap")}>
              <MenuItem
                disabled={!container}
                onClick={() => {
                  if (!container || !unwrapAt(editor, container)) toast(t("That could not be unwrapped."), { tone: "error" });
                  close();
                }}
              >
                <span aria-hidden className="w-5 text-center">
                  ⤢
                </span>
                {container ? t("Take the content out of the container") : t("Not in a container")}
              </MenuItem>
            </MenuSection>
          </div>
        );
      }}
    </Dropdown>
  );
}
