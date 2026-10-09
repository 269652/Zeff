"use client";

import { useState, type ReactNode } from "react";
import type { TagLite } from "@/lib/tags-shared";

/**
 * An entry's tags folded into one "+N ›" badge kept on a line with `lead` (the type
 * badge), so the column stays narrow; clicking it reveals the tags, which wrap below.
 * The folded badge lists them on hover.
 */
export function CollapsibleTags({ tags, lead }: { tags: TagLite[]; lead?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const names = tags.map((t) => `#${t.name}`).join(" ");
  return (
    <div className="flex flex-wrap gap-1">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {lead}
        {tags.length > 0 && (
          <button
            type="button"
            className="badge badge-tag cursor-pointer gap-0.5 hover:brightness-95 dark:hover:brightness-125"
            aria-expanded={open}
            aria-label={open ? "Hide tags" : `Show ${tags.length} tag${tags.length === 1 ? "" : "s"}: ${names}`}
            title={open ? "Hide tags" : names}
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
        tags.map((t) => (
          <span key={t.id} className="badge badge-tag">
            #{t.name}
          </span>
        ))}
    </div>
  );
}
