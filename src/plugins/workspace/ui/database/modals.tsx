"use client";

import { useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { tryRulesAction, setAgentsAction, setReceiveAction } from "../../actions";
import type { DbSchema } from "../../model";
import { Modal } from "../kit";

/** Open a database to receive rows from others: the select / status property and the column they land in. */
export function ReceiveModal({ schema, dbId, onSaved, onClose }: { schema: DbSchema; dbId: number; onSaved: () => void; onClose: () => void }) {
  const t = useT();
  const choices = schema.properties.filter((p) => (p.type === "status" || p.type === "select") && (p.options?.length ?? 0) > 0);
  const [on, setOn] = useState(!!schema.receive);
  const [prop, setProp] = useState(schema.receive?.prop ?? choices[0]?.id ?? "");
  const [value, setValue] = useState(schema.receive?.value ?? choices[0]?.options?.[0]?.id ?? "");
  const options = choices.find((p) => p.id === prop)?.options ?? [];
  const save = async () => {
    const r = await setReceiveAction(dbId, on && prop && value ? { prop, value } : null);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    onSaved();
    onClose();
  };
  return (
    <Modal title={t("Receive tickets")} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> {t("Open to receive rows from other boards")}
        </label>
        {choices.length === 0 ? (
          <p className="text-zinc-500">{t("It needs a select or status property with a column to land in — add one first.")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {t("Land in")}
            <select className="input w-auto text-sm" value={prop} disabled={!on} onChange={(e) => (setProp(e.target.value), setValue(choices.find((p) => p.id === e.target.value)?.options?.[0]?.id ?? ""))} aria-label={t("Property")}>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className="input w-auto text-sm" value={value} disabled={!on} onChange={(e) => setValue(e.target.value)} aria-label={t("Column")}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-xs text-zinc-500">{t("A row sent here stays linked to its source: what changes there (title, fields of the same name, its text) is followed here. “Unlink” makes it a copy.")}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
            {t("Save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A jobs database's agents: Ready cards taken by themselves (off by default), how many at once, how many a day, a default instruction. */
export function AgentsModal({ schema, dbId, onSaved, onClose }: { schema: DbSchema; dbId: number; onSaved: () => void; onClose: () => void }) {
  const t = useT();
  const cur = schema.agents;
  const [auto, setAuto] = useState(!!cur?.auto);
  const [parallel, setParallel] = useState(cur?.parallel ?? 1);
  const [perDay, setPerDay] = useState(cur?.perDay ?? 20);
  const [text, setText] = useState(cur?.defaultInstruction ?? "");
  const save = async () => {
    const r = await setAgentsAction(dbId, { auto, parallel, perDay, defaultInstruction: text });
    if (!r.ok) return void toast(r.error, { tone: "error" });
    onSaved();
    onClose();
  };
  return (
    <Modal title={t("Agents")} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>
            {t("Agents take the cards in Ready by themselves")}
            <span className="block text-xs text-zinc-500">{t("Each one runs as a worker (it costs, like any worker run). Cards already in Ready start as soon as you save. Off: a job starts only when you start it.")}</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5">
            {t("Workers at once")}
            <input type="number" min={1} max={8} className="input w-20 py-0.5 text-sm" value={parallel} disabled={!auto} onChange={(e) => setParallel(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
          </label>
          <label className="flex items-center gap-1.5">
            {t("At most per day")}
            <input type="number" min={1} max={200} className="input w-20 py-0.5 text-sm" value={perDay} disabled={!auto} onChange={(e) => setPerDay(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <label className="block">
          {t("Default instruction")}
          <span className="block text-xs text-zinc-500">{t("For a job without an instruction of its own — a ticket sent here: what the agent does with it.")}</span>
          <textarea className="input mt-1 w-full text-sm" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("e.g. Work the linked ticket: read it, do what it asks, report what you did.")} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
            {t("Save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** "Try the rules": per rule, the records it would hit now (in order — a dropped record meets no later rule) — nothing written. */
export function TryRules({ dbId }: { dbId: number }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<{ rules: { id: number; title: string; then: string; hits: { ref: string; title: string }[] }[]; records: number; databases: { id: number; title: string }[] } | null>(null);
  const THEN: Record<string, string> = { exclude: t("would drop"), set: t("would set a field on"), job: t("would make a job for") };
  return (
    <>
      <button
        type="button"
        className="btn btn-sm shrink-0"
        disabled={busy}
        title={t("Try the rules on what the pipelines read now — nothing is changed, no job made")}
        onClick={async () => {
          setBusy(true);
          const r = await tryRulesAction(dbId);
          setBusy(false);
          if (!r.ok) return void toast(r.error, { tone: "error" });
          setGot(r);
        }}
      >
        {busy ? "…" : `🧪 ${t("Try it")}`}
      </button>
      {got && (
        <Modal title={t("The rules tried — nothing was changed")} onClose={() => setGot(null)}>
          <p className="mb-2 text-sm text-zinc-500">{got.databases.length ? t("{n} records of {dbs}", { n: got.records, dbs: got.databases.map((d) => d.title).join(", ") }) : t("No pipeline applies these rules yet (a rules step in a database's pipeline).")}</p>
          <ul className="space-y-2 text-sm">
            {got.rules.map((r) => (
              <li key={r.id}>
                <div className="font-medium">
                  {r.title} <span className="font-normal text-zinc-500">· {THEN[r.then] ?? r.then} {t("{n} records", { n: r.hits.length })}</span>
                </div>
                {r.hits.length > 0 && (
                  <ul className="pl-3 text-xs text-zinc-500">
                    {r.hits.slice(0, 8).map((h) => (
                      <li key={h.ref} className="truncate">
                        {h.title}
                      </li>
                    ))}
                    {r.hits.length > 8 && <li>… +{r.hits.length - 8}</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
