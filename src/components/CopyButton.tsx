"use client";

import { useState, type ReactNode } from "react";

/** Copy text to the clipboard — the API, else a hidden textarea (older or locked-down browsers). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

/** A button that copies `text` and says so for a moment. `children` (an icon, say) stands in for `label`. */
export function CopyButton({
  text,
  label = "Copy",
  className = "btn btn-sm",
  title,
  children,
}: {
  text: string;
  label?: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={title}
      onClick={async () => {
        if (!(await copyText(text))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied ✓" : (children ?? label)}
    </button>
  );
}
