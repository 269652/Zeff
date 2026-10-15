"use client";

import { useState, type ReactNode } from "react";
import type { TagLite } from "@/lib/tags-shared";
import { useT } from "@/components/I18nProvider";

/**
 * An entry's tags folded into one "+N ›" badge kept on a line with `lead` (the type
 * badge), so the column stays narrow; clicking it reveals the tags, which wrap below.
 * The folded badge lists them on hover.
 */
export function CollapsibleTags({ tags, lead }: { tags: TagLite[]; lead?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const names = tags.map((tag) => `#${tag.name}`).join(" ");
  return (
    <div className="flex flex-wrap gap-1">
      <span className="inline-flex flex-wrap items-center gap-1">
        {lead}
        {tags.length > 0 && (
          <button
            type="button"
            className="badge badge-tag cursor-pointer gap-0.5 hover:brightness-95 dark:hover:brightness-125"
            aria-expanded={open}
            aria-label={open ? t("Hide tags") : tags.length === 1 ? t("Show 1 tag: {names}", { names }) : t("Show {n} tags: {names}", { n: tags.length, names })}
            title={open ? t("Hide tags") : names}
            onClick={() => setOpen(!open)}
          >
            +{tags.length}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        )}
      </span>
      {open &&
        tags.map((tag) => (
          <span key={tag.id} className="badge badge-tag">
            #{tag.name}
          </span>
        ))}
    </div>
  );
}
