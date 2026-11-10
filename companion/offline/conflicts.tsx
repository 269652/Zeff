import { useReplica } from "./main";
import { fmtDay, tr } from "./words";

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? (v.length > 160 ? `${v.slice(0, 160)} …` : v) : typeof v === "boolean" ? (v ? "✓" : "✗") : "…");

/** What the sync couldn't keep: edits made on the PC and here (the later one stayed), and edits the PC refused. */
export function ConflictsView({ onDone }: { onDone: () => void }) {
  const { engine } = useReplica();
  const conflicts = engine.conflicts();
  const failures = engine.failures();
  if (!conflicts.length && !failures.length) return <p className="px-1 text-sm text-zinc-500">{tr("noConflicts")}</p>;
  return (
    <div className="space-y-3">
      {conflicts.length > 0 && <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">{tr("conflictsIntro")}</p>}
      <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
        {conflicts.map((c) => (
          <li key={`${c.id}-${c.field}`} data-zo="conflict" className="space-y-1 px-3 py-2.5 text-sm">
            <p>
              <span className="font-medium">{c.label || c.key}</span> <span className="text-xs text-zinc-500">· {c.field} · {fmtDay(c.at)}</span>
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">{c.kept === "phone" ? tr("keptPhone", { lost: show(c.lost) }) : tr("keptPc", { lost: show(c.lost) })}</p>
          </li>
        ))}
        {failures.map((f) => (
          <li key={f.op.id} data-zo="conflict" className="space-y-1 px-3 py-2.5 text-sm">
            <p>
              <span className="font-medium">{f.op.kind}</span> <span className="text-xs text-zinc-500">· {fmtDay(f.op.at)}</span>
            </p>
            <p className="text-red-700 dark:text-red-400">{tr("failedOp", { error: f.error })}</p>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={() => void engine.dismissConflicts().then(onDone)}>
        {tr("Got it")}
      </button>
    </div>
  );
}
