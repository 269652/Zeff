"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Text that is edited where it stands (contenteditable, no box): a title, a description. Committed when it is left or on Enter;
 * what is pasted is plain text. Shows its placeholder while empty.
 */
export function Inline({ value, onCommit, placeholder, label, className, readOnly }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string; className?: string; readOnly?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [first] = useState(value);
  // (A change from outside — undo, the AI writing it — shows unless the text is being typed.)
  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value && document.activeElement !== el) el.textContent = value;
  }, [value]);
  if (readOnly) return <span className={className}>{value}</span>;
  return (
    <span
      ref={ref}
      role="textbox"
      tabIndex={0}
      aria-label={label}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      className={`ws-inline-edit ${className ?? ""}`}
      onBlur={(e) => {
        const v = (e.currentTarget.textContent ?? "").replace(/\s+/g, " ").trim();
        if (v !== value) onCommit(v);
        else if (e.currentTarget.textContent !== value) e.currentTarget.textContent = value;
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s+/g, " "));
      }}
    >
      {first}
    </span>
  );
}
