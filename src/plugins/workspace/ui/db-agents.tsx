"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { catchUpAgentAction, databaseAgentsAction } from "../actions";

/**
 * The agents that fill this database on a schedule (the journal's reviews): each a button that has it catch up on the periods it
 * missed — a run that couldn't reach Zeff leaves a gap, and the next scheduled one only looks at its own period. Nothing without such an agent.
 */
export function DatabaseAgents({ dbId }: { dbId: number }) {
  const t = useT();
  const [agents, setAgents] = useState<{ pageId: number; title: string }[]>([]);
  const [started, setStarted] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    void databaseAgentsAction(dbId).then((r) => live && r.ok && setAgents(r.agents));
    return () => {
      live = false;
    };
  }, [dbId]);
  if (!agents.length) return null;
  const start = async (pageId: number) => {
    setStarted((s) => [...s, pageId]);
    const r = await catchUpAgentAction(pageId);
    if (!r.ok || r.status === "failed") {
      setStarted((s) => s.filter((x) => x !== pageId));
      return void toast(r.error || t("Didn't work."), { tone: "error" });
    }
    toast(t("The agent is running — it shows in the Code tab."));
  };
  return (
    <div className="flex flex-wrap gap-2">
      {agents.map((a) => (
        <button key={a.pageId} type="button" className="btn btn-sm" disabled={started.includes(a.pageId)} title={t("Writes what is missing for every finished period, not only the last one")} onClick={() => void start(a.pageId)}>
          ▶ {started.includes(a.pageId) ? t("{title}: catching up …", { title: a.title }) : t("{title}: catch up", { title: a.title })}
        </button>
      ))}
    </div>
  );
}
