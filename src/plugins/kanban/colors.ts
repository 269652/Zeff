/** A board's colour as a dot (static class names, for Tailwind). */
const DOT: Record<string, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  zinc: "bg-zinc-500",
};
export const boardDot = (c: string) => DOT[c] ?? DOT.indigo;
