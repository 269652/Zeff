"use client";

import { useRef, useState } from "react";
import {
  dedupeTags,
  hashtagAtCaret,
  normalizeTagName,
} from "@/lib/tags-shared";
import { useT } from "@/components/I18nProvider";
import { useComboboxKeys } from "@/components/Combobox";

/**
 * A description field with #tag autocomplete. Typing `#` shows a popup of
 * existing tags; confirming one removes the `#word` from the text and adds it as
 * a tag chip. Submits the cleaned description as `name` and each tag as a hidden
 * `tags` input, so a plain form picks them up.
 */
export function TagInput({
  name = "description",
  allTags,
  defaultDescription = "",
  defaultTags = [],
  tags: controlledTags,
  onTagsChange,
  autoTags = [],
  placeholder,
  required,
}: {
  name?: string;
  allTags: string[];
  defaultDescription?: string;
  defaultTags?: string[];
  /** Controlled tags (with onTagsChange); otherwise TagInput keeps its own, starting at defaultTags. */
  tags?: string[];
  onTagsChange?: (tags: string[]) => void;
  /** Tags filled in from the job/project/ticket defaults — shown dashed. */
  autoTags?: string[];
  placeholder?: string;
  required?: boolean;
}) {
  const t = useT();
  const [description, setDescription] = useState(defaultDescription);
  const [ownTags, setOwnTags] = useState<string[]>(() => dedupeTags(defaultTags));
  const tags = controlledTags ?? ownTags;
  const setTags = (update: (prev: string[]) => string[]) => {
    const next = update(tags);
    if (controlledTags === undefined) setOwnTags(next);
    onTagsChange?.(next);
  };
  const auto = new Set(autoTags.map((t) => t.toLowerCase()));
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const lower = new Set(tags.map((t) => t.toLowerCase()));
  const matches = query
    ? allTags
        .filter((t) => !lower.has(t.toLowerCase()) && t.toLowerCase().includes(query.text.toLowerCase()))
        .slice(0, 6)
    : [];
  const canCreate =
    query !== null &&
    query.text.length > 0 &&
    !allTags.some((t) => t.toLowerCase() === query.text.toLowerCase()) &&
    !lower.has(query.text.toLowerCase());
  const options = [...matches, ...(canCreate ? [`__create__:${normalizeTagName(query!.text)}`] : [])];

  function sync(el: HTMLTextAreaElement) {
    setDescription(el.value);
    setQuery(hashtagAtCaret(el.value, el.selectionStart ?? el.value.length));
    keys.reset();
  }

  function addTag(raw: string) {
    const t = normalizeTagName(raw);
    if (t) setTags((prev) => dedupeTags([...prev, t]));
  }

  function confirmAt(index: number) {
    if (!query) return;
    const opt = options[index];
    if (opt === undefined) return;
    const tag = opt.startsWith("__create__:") ? opt.slice("__create__:".length) : opt;
    // Remove the "#query" span from the description.
    const end = query.start + 1 + query.text.length;
    const next = (description.slice(0, query.start) + description.slice(end)).replace(/[ \t]{2,}/g, " ");
    setDescription(next);
    addTag(tag);
    setQuery(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = query.start;
      }
    });
  }

  // (With no popup the keys are the text area's own.)
  const keys = useComboboxKeys({ count: options.length, open: !!query && options.length > 0, onPick: confirmAt, wrap: true, tab: true, start: 0, ignoreClosed: true, onEscape: () => setQuery(null) });
  const { active } = keys;

  return (
    <div className="relative">
      {tags.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`badge badge-tag inline-flex items-center gap-1 ${auto.has(tag.toLowerCase()) ? "border-dashed" : ""}`}
              title={auto.has(tag.toLowerCase()) ? t("Default tag of the job, project or ticket — × removes it from this entry") : undefined}
            >
              #{tag}
              <button
                type="button"
                aria-label={t("Remove {tag}", { tag })}
                className="text-current/70 hover:text-current"
                onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        name={name}
        aria-label={t("Report")}
        rows={2}
        required={required}
        className="input"
        placeholder={placeholder ?? t("What was done? Type # to tag")}
        value={description}
        onChange={(e) => sync(e.currentTarget)}
        onClick={(e) => setQuery(hashtagAtCaret(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
        onKeyDown={keys.onKeyDown}
        role="combobox"
        aria-expanded={!!query && options.length > 0}
        aria-controls={keys.listId}
        aria-activedescendant={keys.activeDescendant}
        aria-autocomplete="list"
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />

      {query && options.length > 0 && (
        <ul id={keys.listId} role="listbox" className="absolute z-20 mt-1 max-h-56 w-64 overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {options.map((opt, i) => {
            const creating = opt.startsWith("__create__:");
            const tag = creating ? opt.slice("__create__:".length) : opt;
            return (
              <li key={opt} id={keys.optionId(i)} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                    i === active ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    confirmAt(i);
                  }}
                >
                  <span className="font-mono">#{tag}</span>
                  {creating && <span className="text-xs text-zinc-400">— {t("create")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {tags.map((t) => (
        <input key={t} type="hidden" name="tags" value={t} />
      ))}
    </div>
  );
}
