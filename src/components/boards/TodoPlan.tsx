import type { TodoView } from "@/lib/boards/shared";
import { TodoRefs } from "./TodoRefs";
import { useT } from "@/components/I18nProvider";

/** What's planned after a todo, quietly: "Danach: Review → Deploy → Testen" — a line per path when there are alternatives. */
export function TodoPlan({ t: todo }: { t: Pick<TodoView, "planned" | "status"> }) {
  const t = useT();
  if (!todo.planned.length || todo.status !== "open") return null;
  return (
    <span className="mt-1 block space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400" title={t("Planned: each step becomes a todo once the one before is done — with several paths, the others drop away once one is taken")}>
      {todo.planned.map((p, i) => (
        <span key={i} className="block">
          <span className="font-medium">
            {todo.planned.length > 1
              ? p.path != null
                ? t("Then ({path}):", { path: p.path })
                : t("Then (path {n}):", { n: i + 1 })
              : t("Then:")}
          </span>{" "}
          <TodoRefs text={p.steps.map((s) => s.text).join(" → ")} />
        </span>
      ))}
    </span>
  );
}
