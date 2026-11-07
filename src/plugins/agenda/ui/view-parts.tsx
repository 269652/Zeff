"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useT } from "@/components/I18nProvider";
import { Modal } from "@/components/Modal";
import { toast } from "@/components/Toaster";
import { addAgendaNoteAction } from "../server-actions";
import type { Property } from "@/plugins/workspace/model";
import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";

/** Agenda's screen, client side: the form for a new note — the toolbar's New and the screen's own button open it. */

const today = () => new Date().toLocaleDateString("sv-SE");

function NewNote(p: PartProps) {
  const t = useT();
  const props = p.data.schema.properties;
  const byName = (name: string | undefined) => (name ? props.find((x: Property) => x.name.toLowerCase() === name.toLowerCase()) : undefined);
  const date = byName(p.attrs.date);
  const project = byName(p.attrs.project);
  const agenda = byName(p.attrs.agenda);
  const pinned = byName(p.attrs.pinned);
  const tags = byName(p.attrs.tags);
  const projects = project?.relationDb !== undefined ? (p.data.related[project.relationDb]?.rows ?? []) : [];

  const [title, setTitle] = useState("");
  const [start, setStart] = useState(today());
  const [dated, setDated] = useState(true);
  const [ranged, setRanged] = useState(false);
  const [end, setEnd] = useState("");
  const [proj, setProj] = useState(p.state.p ? String(projects.find((r) => r.title === p.state.p)?.id ?? "") : "");
  const [onAgenda, setOnAgenda] = useState(p.state.scope === "agenda");
  const [pin, setPin] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [fresh, setFresh] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (p.state.adding !== "true") return null;
  const close = () => p.setState("adding", "");

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      // By the fields' names: the server makes a tag that isn't there yet (and everything in one step).
      const values: Record<string, unknown> = {};
      if (date && dated && start) values[date.name] = ranged && end && end > start ? { start, end } : start;
      if (project && proj) values[project.name] = [Number(proj)];
      if (agenda && onAgenda) values[agenda.name] = true;
      if (pinned && pin) values[pinned.name] = true;
      if (tags) {
        const names = [...picked.map((id) => tags.options?.find((o) => o.id === id)?.name ?? ""), ...fresh.split(",").map((x) => x.trim())].filter(Boolean);
        if (names.length) values[tags.name] = [...new Set(names)];
      }
      const r = await addAgendaNoteAction({ dbId: p.data.id, title: title.trim(), values, markdown: text });
      if (!r.ok) throw new Error(r.error);
      p.reload();
      close();
      toast(t("Note added."));
    } catch (x) {
      toast(x instanceof Error ? x.message : String(x), { tone: "error" });
    }
    setBusy(false);
  };
  // Ctrl+Enter (⌘+Enter) saves from anywhere in the form.
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
  };

  return (
    <Modal title={t("New note")} onClose={close}>
      <form className="space-y-4" onSubmit={save} onKeyDown={keys}>
        <input className="input text-base font-medium" aria-label={t("Title")} placeholder={t("What is it about?")} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

        {date && (
          <fieldset className="space-y-2">
            <legend className="label">{t("Date")}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="accent-indigo-600" checked={dated} onChange={(e) => setDated(e.target.checked)} />
                {t("Dated")}
              </label>
              {dated && (
                <>
                  <input type="date" className="input w-auto" aria-label={t("From")} value={start} onChange={(e) => setStart(e.target.value)} />
                  <label className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="accent-indigo-600" checked={ranged} onChange={(e) => setRanged(e.target.checked)} />
                    {t("Until")}
                  </label>
                  {ranged && <input type="date" className="input w-auto" aria-label={t("Until")} min={start} value={end} onChange={(e) => setEnd(e.target.value)} />}
                </>
              )}
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 7].map((d) => (
                <button key={d} type="button" className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => (setDated(true), setStart(new Date(Date.now() + d * 864e5).toLocaleDateString("sv-SE")))}>
                  {d === 0 ? t("Today") : d === 1 ? t("Tomorrow") : t("In a week")}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {project && (
            <label className="block text-sm">
              <span className="label">{t("Project")}</span>
              <select className="input" value={proj} onChange={(e) => setProj(e.target.value)}>
                <option value="">—</option>
                {projects.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title || t("Untitled")}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-col justify-end gap-1.5 text-sm">
            {agenda && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="accent-indigo-600" checked={onAgenda} onChange={(e) => setOnAgenda(e.target.checked)} />
                {t("On the agenda")}
              </label>
            )}
            {pinned && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="accent-indigo-600" checked={pin} onChange={(e) => setPin(e.target.checked)} />
                {t("Pin to the top")}
              </label>
            )}
          </div>
        </div>

        {tags && (
          <fieldset className="space-y-1.5">
            <legend className="label">{t("Tags")}</legend>
            {(tags.options?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.options!.map((o) => {
                  const on = picked.includes(o.id);
                  return (
                    <button key={o.id} type="button" aria-pressed={on} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`} onClick={() => setPicked((l) => (on ? l.filter((x) => x !== o.id) : [...l, o.id]))}>
                      #{o.name}
                    </button>
                  );
                })}
              </div>
            )}
            <input className="input text-sm" aria-label={t("New tags")} placeholder={t("New tags, separated by commas")} value={fresh} onChange={(e) => setFresh(e.target.value)} />
          </fieldset>
        )}

        <label className="block text-sm">
          <span className="label">{t("Note")}</span>
          <textarea className="input min-h-32 font-sans" value={text} placeholder={t("Write … (- [ ] makes a checklist)")} onChange={(e) => setText(e.target.value)} />
        </label>

        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-zinc-500">{t("Ctrl+Enter saves")}</span>
          <button type="button" className="btn btn-sm" onClick={close}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>
            {t("Add note")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const view: ViewAppModule = {
  parts: { "agenda.new": NewNote },
  useAppData: useNoAppData,
  actions: { "agenda.new": (env) => env.setState("adding", "true") },
  // The toolbar's New: the form, not a bare row.
  onNew: (env) => env.setState("adding", "true"),
};
export default view;
