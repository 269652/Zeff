"use client";

import { useId, useState } from "react";
import { dedupeTags, normalizeTagName } from "@/lib/tags-shared";

/**
 * Tags as removable chips plus an input that suggests existing tags: Enter, a comma or
 * picking a suggestion adds one, Backspace on the empty input removes the last. Posts each
 * tag as a hidden `name` input (when named); `onChange` reports every edit.
 */
export function TagsField({
  name = "defaultTags",
  allTags,
  defaultValue = [],
  onChange,
  placeholder = "Add tag…",
  disabled = false,
  compact = false,
  id,
}: {
  /** Form field for the tags; "" posts nothing (e.g. when onChange saves them). */
  name?: string;
  allTags: string[];
  defaultValue?: string[];
  onChange?: (tags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Smaller, for table cells. */
  compact?: boolean;
  id?: string;
}) {
  const [tags, setTags] = useState(() => dedupeTags(defaultValue));
  const [draft, setDraft] = useState("");
  const listId = useId();

  function update(next: string[]) {
    const tidy = dedupeTags(next);
    setTags(tidy);
    onChange?.(tidy);
  }

  function add(raw: string) {
    const tag = normalizeTagName(raw.replace(/[,;]+$/, ""));
    setDraft("");
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) update([...tags, tag]);
  }

  return (
    <div className={`input flex flex-wrap items-center gap-1 ${compact ? "min-h-7 py-0.5" : "min-h-9 py-1"} ${disabled ? "opacity-60" : ""}`}>
      {tags.map((t) => (
        <span key={t} className="badge badge-tag inline-flex items-center gap-1">
          #{t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            className="text-current/70 hover:text-current"
            disabled={disabled}
            onClick={() => update(tags.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        list={listId}
        value={draft}
        disabled={disabled}
        placeholder={tags.length ? "" : placeholder}
        className={`flex-1 bg-transparent outline-none ${compact ? "min-w-14 text-xs" : "min-w-24 text-sm"}`}
        onChange={(e) => {
          const v = e.target.value;
          // A picked suggestion arrives without an inputType; a typed comma ends a tag.
          const picked = !(e.nativeEvent as InputEvent).inputType && allTags.some((t) => t.toLowerCase() === v.trim().toLowerCase());
          if (picked || /[,;]$/.test(v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            update(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={listId}>
        {allTags
          .filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
      {name &&
        tags.map((t) => (
          <input key={t} type="hidden" name={name} value={t} />
        ))}
    </div>
  );
}
