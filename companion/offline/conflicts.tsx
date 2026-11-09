import { useReplica } from "./main";
import { fmtDay, tr } from "./words";

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? (v.length > 160 ? `${v.slice(0, 160)} …` : v) : typeof v === "boolean" ? (v ? "✓" : "✗") : "…");

/** What the sync couldn't keep: edits made on the PC and here (the later one stayed), and edits the PC refused. */
export function ConflictsView({ onDone }: { onDone: () => void }) {
  const { engine } = useReplica();
  const conflicts = engine.conflicts();
  const failures = engine.failures();
  if (!conflicts.length && !failures.length) return <p className="zo-muted zo-page">{tr("noConflicts")}</p>;
  return (
    <div className="zo-page">
      {conflicts.length > 0 && <p>{tr("conflictsIntro")}</p>}
      <ul className="zo-list">
        {conflicts.map((c) => (
          <li key={`${c.id}-${c.field}`} className="zo-conflict">
            <strong>{c.label || c.key}</strong> <small>· {c.field} · {fmtDay(c.at)}</small>
            <p>{c.kept === "phone" ? tr("keptPhone", { lost: show(c.lost) }) : tr("keptPc", { lost: show(c.lost) })}</p>
          </li>
        ))}
        {failures.map((f) => (
          <li key={f.op.id} className="zo-conflict">
            <strong>{f.op.kind}</strong> <small>· {fmtDay(f.op.at)}</small>
            <p>{tr("failedOp", { error: f.error })}</p>
          </li>
        ))}
      </ul>
      <button type="button" className="zo-btn" onClick={() => void engine.dismissConflicts().then(onDone)}>
        {tr("Got it")}
      </button>
    </div>
  );
}
