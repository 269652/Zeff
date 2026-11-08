"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { createFlowAction, runFlowAction } from "@/plugins/workspace/actions";
import { askWorkspace } from "@/plugins/workspace/ui/chat-client";
import { ASKS_EVENT } from "@/plugins/workspace/ui/flow-asks";
import { STARTERS } from "../starters";

/**
 * A new automation: one of the starts — each an ordinary flow of blocks (a schedule, a question to you, a database made sure of, a row
 * written …) that opens in the flow editor to be changed — or anything described in words, built by the assistant from the same blocks.
 */

export function NewAutomation({ onMade }: { onMade: (v: { flowPage?: number }) => void }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [describe, setDescribe] = useState("");
  const [steps, setSteps] = useState<string[] | null>(null);

  const use = async (id: string) => {
    const s = STARTERS.find((x) => x.id === id)!;
    setBusy(id);
    // (A free name: the start's, numbered.)
    let r = await createFlowAction(s.def(s.id));
    for (let i = 2; !r.ok && /already/.test(r.error) && i < 50; i++) r = await createFlowAction(s.def(`${s.id}-${i}`));
    if (!r.ok) return (setBusy(null), toast(r.error, { tone: "error" }));
    if (s.runNow) {
      await runFlowAction(r.flow.name, {}, {});
      window.dispatchEvent(new Event(ASKS_EVENT));
    }
    setBusy(null);
    toast(s.runNow ? t("Made — it runs once now (see the corner), then on its schedule. Change any block in the editor.") : t("Made — change any block in the editor."), { tone: "ok", ms: 8000 });
    onMade({ flowPage: r.flow.pageId });
  };

  const build = async () => {
    if (!describe.trim()) return;
    setSteps([]);
    const request = `${describe.trim()}\n\nBau das in Zeff aus Flow-Bausteinen: Lies zuerst workspace_flow_docs. Fragen an mich mit dem Knoten "ask"; Datenbanken mit der Aktion db.ensure (mit Datum/Zeit-Feld, wenn etwas über die Zeit gesammelt wird; was mich selbst betrifft, unter "Journal" mit orTop: true); Schreiben mit db.insert; Zeitpläne mit Zeitfenster. Probiere jeden Flow mit workspace_run_flow (dry: true). Sag am Ende in zwei, drei Sätzen, was du gebaut hast und welche Rechte ich in der Studio noch gewähren muss.`;
    const r = await askWorkspace([{ role: "user", text: request }], undefined, (s) => setSteps(s.map((x) => `${x.ok ? "✓" : "✗"} ${x.summary}`)));
    setSteps(null);
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(r.reply || t("Done."), { tone: "ok", ms: 15000 });
    setDescribe("");
    onMade({});
  };

  return (
    <div className="max-w-5xl space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t("A new automation")}</h2>
        <p className="text-sm text-zinc-500">{t("Each start is a flow of blocks — a schedule, a question to you, a database, a row written — that opens in the editor: change the question, the answers, the schedule, where it goes.")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {STARTERS.filter((s) => s.automation).map((s) => (
            <button key={s.id} type="button" disabled={busy !== null} className="card space-y-1 p-3 text-left transition hover:border-indigo-300 hover:shadow-md disabled:opacity-60" onClick={() => void use(s.id)}>
              <div className="font-medium">{busy === s.id ? t("Working …") : t(s.label)}</div>
              <div className="text-xs text-zinc-500">{t(s.what)}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">✨ {t("Describe it")}</h2>
        <p className="text-sm text-zinc-500">{t("Anything else, in your words — the assistant builds it from the same blocks and says what it made.")}</p>
        <textarea
          className="input"
          rows={5}
          value={describe}
          placeholder={t("E.g. “Every evening at 9 ask me what I'm grateful for and put it into the journal entry of the day” or “Each Monday look up new films of my favourite directors at TMDB and put them into the watch list”")}
          onChange={(e) => setDescribe(e.target.value)}
        />
        <button type="button" className="btn btn-primary" disabled={steps !== null || !describe.trim()} onClick={() => void build()}>
          {steps !== null ? t("Building …") : t("Build it")}
        </button>
        {steps && steps.length > 0 && (
          <ul className="space-y-0.5 text-xs text-zinc-500">
            {steps.slice(-8).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
