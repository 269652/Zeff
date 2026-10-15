"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "./Toaster";
import { useT } from "@/components/I18nProvider";

/**
 * The one way to take something off a todo — a context item, a note, an action: a ×, shown when
 * the row is hovered (put it in a `group`); the page is refreshed when it's done, an error toasts.
 */
export function DismissButton({ onDismiss, title, label, className = "" }: { onDismiss: () => Promise<{ ok?: boolean; error?: string } | null | undefined>; title: string; label: string; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`icon-btn shrink-0 text-base opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${className}`}
      disabled={pending}
      title={title}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          const r = await onDismiss();
          if (r?.ok) router.refresh();
          else toast(r?.error ?? t("Didn't work."), { tone: "error" });
        });
      }}
    >
      ×
    </button>
  );
}
