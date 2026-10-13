import type { ReactNode } from "react";

/**
 * What a list or section says when there is nothing in it. `inline` sits in the flow of a card or
 * form; `centered` fills a page-level list with some air around it. `faint` is the lighter grey
 * the dashboard cards use.
 */
export function EmptyState({ children, variant = "inline", faint = false }: { children: ReactNode; variant?: "inline" | "centered"; faint?: boolean }) {
  return <p className={`${variant === "centered" ? "py-4 text-center " : ""}text-sm ${faint ? "text-zinc-400" : "text-zinc-500"}`}>{children}</p>;
}
