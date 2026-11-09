"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { T } from "@/lib/i18n/shared";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { peopleOverviewAction, peopleToolAction } from "../block-actions";
import type { PeopleOverview, PeopleTool } from "../tools";
import { peopleAppData, type CardPerson } from "../view-data";
import { PersonCard } from "./PersonCard";

/**
 * The people overview, client side: what its template reads as app.* (the overview, read again while something runs in the
 * background), and the parts it is built of where the language's tags aren't enough — a person's card, the form for a new person,
 * a tool run on the server, a yes/no verdict, the settings.
 */

function usePeopleData(props: AppViewProps, state: Record<string, string>) {
  const t = useT();
  const [o, setO] = useState<PeopleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  // Only the latest load counts.
  const load = useCallback(() => {
    const n = ++seq.current;
    peopleOverviewAction().then(
      (r) => {
        if (n !== seq.current) return;
        if (r.ok) setO(r.overview);
        else setError(r.error);
      },
      (e: unknown) => n === seq.current && setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  useEffect(load, [load]);
  // Running things (finding dates, compiling) go on in the background: look again until they are done.
  const running = !!o?.progress.dates || !!o?.progress.compile;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [running, load]);
  // "Now" fixed when the view opens.
  const [now] = useState(() => Date.now());
  const { circle, only, sort } = state;
  const rows = props.rows;
  const data = useMemo(
    () => (o ? peopleAppData(o, rows, { t, state: { circle, only, sort }, now, locale: typeof navigator !== "undefined" ? navigator.language : undefined }) : { loading: true, error }),
    [o, rows, t, circle, only, sort, now, error],
  );
  return { data, reload: load };
}

const overviewOf = (p: PartProps) => (p.app.overview as PeopleOverview | undefined) ?? null;

type Run = (tool: PeopleTool, key: string) => Promise<{ ok: boolean; draft?: string }>;

/** A tool run on the server: the others wait (state.busy), what came of it as a toast, the overview read again. */
function useRun(p: PartProps): Run {
  const router = useRouter();
  const { setState, reloadApp } = p;
  return useCallback(
    async (tool, key) => {
      setState("busy", key);
      let r: Awaited<ReturnType<typeof peopleToolAction>>;
      try {
        r = await peopleToolAction(tool);
      } finally {
        setState("busy", "");
      }
      if (!r.ok) toast(r.error, { tone: "error" });
      else if (r.message) toast(r.message);
      // A greeting drafted changes nothing to read again.
      if (tool.tool !== "greeting") {
        reloadApp();
        router.refresh();
      }
      return r.ok ? { ok: true, draft: r.draft } : { ok: false };
    },
    [setState, reloadApp, router],
  );
}

/** A person's card (the row it stands for). */
function CardPart(p: PartProps) {
  const run = useRun(p);
  const o = overviewOf(p);
  const person = (p.app.people as CardPerson[] | undefined)?.find((x) => x.id === p.rowId);
  if (!o || !person) return null;
  return <PersonCard p={person} info={person.personId ? o.cards[person.personId] : undefined} now={Number(p.app.now)} soonUntil={String(p.app.soonUntil)} weeks={o.settings.weeks} open={() => p.openRow(person.id)} run={run} />;
}

/** The form for a new person: a name; Escape (or adding it) closes it. */
function AddPart(p: PartProps) {
  const t = useT();
  const run = useRun(p);
  const [name, setName] = useState("");
  const close = () => p.setState("adding", "");
  return (
    <form
      className="flex gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await run({ tool: "add", name }, "add");
        setName("");
        close();
      }}
    >
      <input className="input w-44 py-1 text-sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && close()} placeholder={t("Name…")} aria-label={t("New person")} />
      <button className="btn btn-primary btn-sm" disabled={!!p.state.busy || !name.trim()}>
        {t("Add")}
      </button>
    </form>
  );
}

/** The tool a part's attributes name (null: one it doesn't know, or a suggestion no longer there). */
function toolOf(a: Record<string, string>, o: PeopleOverview | null): PeopleTool | null {
  switch (a.tool) {
    case "import":
    case "findAll":
    case "normalize":
    case "linkJira":
      return { tool: a.tool };
    case "classify":
    case "acceptConfident":
      return { tool: a.tool };
    case "extract":
      return { tool: "extract", days: Number(a.days) || 0 };
    case "compile":
      return { tool: "compile" };
    case "compileAgain":
      return { tool: "compile", force: true };
    case "snooze":
      return Number(a.person) ? { tool: "snooze", id: Number(a.person), days: Number(a.days) || 14 } : null;
    case "add": {
      if (a.whatsapp) return { tool: "add", name: a.whatsapp, whatsapp: a.whatsapp };
      const k = o?.suggestions.persons.find((x) => x.id === Number(a.entity));
      return k ? { tool: "add", name: k.name, entityId: k.id, aliases: k.aliases } : null;
    }
    default:
      return null;
  }
}

/** A button that runs a tool: "…" while it runs, the others disabled meanwhile; a suggestion to take over as a chip. */
function ToolPart(p: PartProps) {
  const run = useRun(p);
  const a = p.attrs;
  const op = toolOf(a, overviewOf(p));
  if (!op) return null;
  const key = `${a.tool}${a.person ?? a.entity ?? a.whatsapp ?? ""}`;
  const busy = p.state.busy ?? "";
  const label = busy === key ? "…" : (a.label ?? a.tool);
  const go = () => void run(op, key);
  if (a.variant === "chip")
    return (
      <button type="button" className="rounded-full border border-zinc-200 px-2 py-0.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" title={a.title} onClick={go}>
        {label} {a.count && <span className="text-xs text-zinc-400">{a.count}</span>}
      </button>
    );
  return (
    <button type="button" className={`btn btn-sm ${a.variant === "primary" ? "btn-primary" : ""} ${a.wide === "true" ? "w-full min-w-0 flex-1 justify-start" : ""}`} disabled={!!busy} title={a.title} onClick={go}>
      {label}
    </button>
  );
}

/** What yes and no do for each kind of thing to check (and what they say, when not right/wrong). */
const VERDICTS: Record<string, { yes: (id: number) => PeopleTool; no?: (id: number) => PeopleTool; key: string; labels?: (t: T) => [string, string] }> = {
  identity: { key: "s", yes: (id) => ({ tool: "suggestion", id, accept: true }), no: (id) => ({ tool: "suggestion", id, accept: false }) },
  commitment: { key: "c", yes: (id) => ({ tool: "claim", id, action: "done" }), labels: (t) => [t("Done"), ""] },
  claim: { key: "c", yes: (id) => ({ tool: "claim", id, action: "confirm" }), no: (id) => ({ tool: "claim", id, action: "reject" }) },
  link: { key: "l", yes: (id) => ({ tool: "link", id, action: "confirm" }), no: (id) => ({ tool: "link", id, action: "reject" }) },
  stale: { key: "c", yes: (id) => ({ tool: "claim", id, action: "recheck" }), no: (id) => ({ tool: "claim", id, action: "reject" }), labels: (t) => [t("Still true"), t("Outdated")] },
  date: { key: "d", yes: (id) => ({ tool: "dateConfirm", id }), no: (id) => ({ tool: "dateDelete", id }) },
};

/** Yes/no for a thing to check — fits the narrow column. */
function VerdictPart(p: PartProps) {
  const t = useT();
  const run = useRun(p);
  const v = VERDICTS[p.attrs.on];
  const id = Number(p.attrs.item);
  if (!v || !id) return null;
  const [yes, no] = v.labels?.(t) ?? [t("Right"), t("Wrong")];
  const btn = "flex size-7 items-center justify-center rounded-md ring-1 ring-inset transition";
  return (
    <span className="flex shrink-0 gap-1">
      <button type="button" className={`${btn} bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-700`} title={yes} aria-label={yes} onClick={() => void run(v.yes(id), `${v.key}${id}`)}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      </button>
      {v.no && (
        <button type="button" className={`${btn} text-zinc-500 ring-zinc-200 hover:bg-zinc-100 hover:text-zinc-800 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100`} title={no} aria-label={no} onClick={() => void run(v.no!(id), `${v.key}${id}`)}>
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
          </svg>
        </button>
      )}
    </span>
  );
}

/** The settings: after how many weeks someone you care about comes up, and your name (your family by your last name). */
function SettingsPart(p: PartProps) {
  const t = useT();
  const run = useRun(p);
  const o = overviewOf(p);
  if (!o) return null;
  const { weeks, myName, aboutMe } = o.settings;
  const save = (v: { weeks?: number; myName?: string; aboutMe?: string }) => void run({ tool: "settings", ...v }, "settings");
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
      <label htmlFor="people-weeks" className="text-xs text-zinc-500">
        {t("Remind after (weeks)")}
      </label>
      <input id="people-weeks" type="number" min={1} max={52} className="input w-20 text-sm" defaultValue={weeks} onBlur={(e) => Number(e.target.value) !== weeks && save({ weeks: Number(e.target.value) })} />
      <label htmlFor="people-me" className="text-xs text-zinc-500">
        {t("Your name")}
      </label>
      <input id="people-me" className="input text-sm" defaultValue={myName} placeholder={t("First and last name")} title={t("People with your last name count as family.")} onBlur={(e) => e.target.value.trim() !== myName && save({ myName: e.target.value })} />
      {/* About you — the same record as Settings → About me (lib/about-me.ts): what the AI should know about you. */}
      <label htmlFor="people-about" className="self-start pt-1.5 text-xs text-zinc-500">
        {t("About me")}
      </label>
      <textarea
        id="people-about"
        className="input text-sm"
        rows={3}
        maxLength={6000}
        defaultValue={aboutMe ?? ""}
        placeholder={t("e.g. I teach F4 at a vocational school.")}
        title={t("The same text as Settings → About me — in front of every AI task.")}
        onBlur={(e) => e.target.value.trim() !== (aboutMe ?? "").trim() && save({ aboutMe: e.target.value })}
      />
    </div>
  );
}

const view: ViewAppModule = {
  parts: {
    "people.card": CardPart,
    "people.add": AddPart,
    "people.tool": ToolPart,
    "people.verdict": VerdictPart,
    "people.settings": SettingsPart,
  },
  useAppData: usePeopleData,
  // The toolbar's New: the name field for a new person.
  onNew: (env) => env.setState("adding", "true"),
};
export default view;
