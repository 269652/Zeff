/**
 * How an action looks on a todo: an icon and a colour by what it does — talking to someone (indigo), resolving or delivering (green),
 * handing over to a worker (violet), a time in the calendar (amber), changing a ticket (blue). Client-safe.
 */
export type OpTone = "indigo" | "emerald" | "sky" | "violet" | "amber" | "zinc";

export function opLook(type: string): { icon: string; tone: OpTone } {
  if (type === "gitlab-resolve") return { icon: "✓", tone: "emerald" };
  if (type === "gitlab-reply") return { icon: "↩", tone: "indigo" };
  if (type === "gitlab-open-mr" || type === "gitlab-merge") return { icon: "⎇", tone: "emerald" };
  if (type === "git-push" || type === "git-merge-main") return { icon: "⬆", tone: "emerald" };
  if (type === "work-instruct") return { icon: "✦", tone: "violet" };
  if (type.startsWith("calendar") || type.startsWith("gcal")) return { icon: "◷", tone: "amber" };
  if (type.startsWith("jira")) return { icon: "◆", tone: "sky" };
  if (type.startsWith("mail") || type.startsWith("gmail")) return { icon: "✉", tone: "indigo" };
  if (type.includes("message") || type.includes("reply") || type.startsWith("teams") || type.startsWith("whatsapp") || type.startsWith("signal")) return { icon: "✎", tone: "indigo" };
  return { icon: "⚡", tone: "zinc" };
}

/** The classes of a tone (written out: Tailwind finds them here). */
export const TONE: Record<OpTone, { bar: string; bubble: string }> = {
  indigo: { bar: "border-l-indigo-400", bubble: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  emerald: { bar: "border-l-emerald-400", bubble: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  sky: { bar: "border-l-sky-400", bubble: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  violet: { bar: "border-l-violet-400", bubble: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  amber: { bar: "border-l-amber-400", bubble: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  zinc: { bar: "border-l-zinc-300", bubble: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};
