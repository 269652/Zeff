"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { receiptTextAction } from "./actions";

/** A receipt's text, opened on a click — exactly what went to the AI. */
export function ReceiptText({ id }: { id: number }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
        aria-expanded={open}
        onClick={async () => {
          if (!open && text === null) {
            const r = await receiptTextAction(id);
            setText(r.ok ? r.text : "—");
          }
          setOpen(!open);
        }}
      >
        {open ? t("Hide the text") : t("Show what went")}
      </button>
      {open && text !== null && <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-zinc-50 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">{text}</pre>}
    </div>
  );
}
