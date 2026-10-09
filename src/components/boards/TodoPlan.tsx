import type { TodoView } from "@/lib/boards/shared";
import { TodoRefs } from "./TodoRefs";

/** What's planned after a todo, quietly: "Danach: Review → Deploy → Testen" — a line per path when there are alternatives. */
export function TodoPlan({ t }: { t: Pick<TodoView, "planned" | "status"> }) {
  if (!t.planned.length || t.status !== "open") return null;
  return (
    <span className="mt-1 block space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400" title="Geplant: jeder Schritt wird zum Todo, sobald der davor erledigt ist — bei mehreren Wegen fallen die anderen weg, sobald einer gegangen ist">
      {t.planned.map((p, i) => (
        <span key={i} className="block">
          <span className="font-medium">{t.planned.length > 1 ? `Danach (${p.path ?? `Weg ${i + 1}`}):` : "Danach:"}</span> <TodoRefs text={p.steps.map((s) => s.text).join(" → ")} />
        </span>
      ))}
    </span>
  );
}
