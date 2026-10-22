"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { GiroCode } from "@/components/GiroCode";
import { Overlay } from "@/components/Overlay";
import { toast } from "@/components/Toaster";
import { amountIn, type Account } from "@/lib/girocode";
import type { ActionEnv, AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { personKnowledgeMergeAction, personWikiAction, type KnowledgeOfPerson } from "../block-actions";
import type { PersonOperation } from "../blocks";
import { detailLabels, personPageData } from "../row-data";
import { loadPerson, runPersonOp, usePersonEntry } from "./person-store";
import { TimelineList } from "@/plugins/timeline/ui/TimelineList";

/**
 * A person's own page, client side: what its template reads as app.* (their bundle and what the knowledge knows), its actions (a
 * verdict, a star, compile, copy, merge …) and the parts it is built of where the language's tags aren't enough — inputs saved on
 * leaving them, the note, the forms to add a detail, a date, a relation, a reminder's days, the transfer with its GiroCode.
 */

/** The row the page is about. */
const rowOf = (p: AppViewProps) => p.rows[0]?.id ?? 0;

function usePersonPage(props: AppViewProps) {
  const t = useT();
  const rowId = rowOf(props);
  const entry = usePersonEntry(rowId);
  // What the knowledge knows: undefined while it is read, null without the knowledge.
  const [wiki, setWiki] = useState<KnowledgeOfPerson | null | undefined>(undefined);
  const [wikiAgain, setWikiAgain] = useState(0);
  useEffect(() => {
    if (!rowId) return;
    let live = true;
    void personWikiAction(rowId).then((r) => live && setWiki(r.ok ? r.wiki : null));
    return () => {
      live = false;
    };
  }, [rowId, wikiAgain]);
  const reload = useCallback(() => {
    void loadPerson(rowId);
    setWikiAgain((n) => n + 1);
  }, [rowId]);
  const data = useMemo(
    () => personPageData({ person: entry.data, error: entry.error, loading: entry.loading, wiki }, { t, locale: typeof navigator !== "undefined" ? navigator.language : undefined }),
    [entry, wiki, t],
  );
  return { data, reload };
}

/** "Saved ✓" beside the card's title for a moment (state.saved). */
const flash = (p: PartProps, what: string) => () => {
  p.setState("saved", what);
  setTimeout(() => p.setState("saved", ""), 1500);
};

const FIELDS = ["name", "aliases", "emails", "whatsapp", "jira"] as const;
type ProfileField = (typeof FIELDS)[number];

/** A line of the profile that saves itself: on leaving it (or Enter) when it changed — no Save button. */
/** What happened with them (the Timeline plugin) — nothing while that plugin is off. */
function TimelinePart(p: PartProps) {
  const t = useT();
  const row = rowOf(p);
  return row ? <TimelineList row={row} limit={25} title={t("Timeline")} hideWhenOff /> : null;
}

function InputPart(p: PartProps) {
  const field = p.attrs.field as ProfileField;
  const profile = p.app.profile as Record<ProfileField, string> | undefined;
  const saved = profile?.[field] ?? "";
  const [value, setValue] = useState(saved);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the line follows the profile as saved
  useEffect(() => setValue(saved), [saved]);
  if (!profile || !FIELDS.includes(field)) return null;
  const commit = async () => {
    if (value === saved) return;
    if (field === "name" && !value.trim()) return setValue(saved);
    if (await runPersonOp(rowOf(p), { op: "profile", [field]: value })) flash(p, "profile")();
  };
  return (
    <label className="block text-sm">
      <span className="label">{p.attrs.label}</span>
      <input className="input" value={value} placeholder={p.attrs.placeholder} onChange={(e) => setValue(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
    </label>
  );
}

/** Your notes: saved while you write (a moment after the last key) and on leaving it — no Save button. */
function NotePart(p: PartProps) {
  const saved = String(p.app.note ?? "");
  const rowId = rowOf(p);
  const [note, setNote] = useState(saved);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the note as saved elsewhere follows
  useEffect(() => setNote(saved), [saved]);
  const save = useCallback((text: string) => void runPersonOp(rowId, { op: "note", note: text }).then((ok) => ok && flash(p, "note")()), [rowId, p]);
  useEffect(() => {
    if (note === saved) return;
    const id = setTimeout(() => save(note), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the text is what restarts the wait
  }, [note]);
  return <textarea className="input resize-y text-sm" rows={Math.min(14, Math.max(4, note.split("\n").length + 1))} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== saved && save(note)} placeholder={p.attrs.placeholder} />;
}

/** "Transfer money": a dialog with the amount and purpose to fill in, and the GiroCode of the transfer to their account. */
function TransferPart(p: PartProps) {
  const t = useT();
  const account = p.app.account as Account | null | undefined;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  if (!account) return null;
  const euros = amount.trim() ? amountIn(`${amount.trim()} €`) : null;
  return (
    <>
      <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(true)}>
        {t("Transfer money")}
      </button>
      <Overlay open={open} onClose={() => setOpen(false)} label={t("Transfer money")} side="center" className="max-w-sm">
        <div className="space-y-3 overflow-y-auto p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("Transfer to {name}", { name: account.name })}</h2>
            <button type="button" className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label={t("Close")} onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="flex gap-1.5">
            <input className="input w-28" inputMode="decimal" placeholder="0,00 €" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t("Amount")} />
            <input className="input min-w-0 flex-1" maxLength={140} placeholder={t("Purpose")} value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label={t("Purpose")} />
          </div>
          {amount.trim() && euros == null && <p className="text-xs text-amber-600 dark:text-amber-400">{t("Not an amount — e.g. 11,52")}</p>}
          <GiroCode {...account} amount={euros} purpose={purpose} />
        </div>
      </Overlay>
    </>
  );
}

/** A detail to add: its kind and value. */
function AddDetailPart(p: PartProps) {
  const t = useT();
  const [key, setKey] = useState("iban");
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-wrap gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) void runPersonOp(rowOf(p), { op: "detail", action: "add", key, value }).then((ok) => ok && setValue(""));
      }}
    >
      <select className="input w-auto" value={key} onChange={(e) => setKey(e.target.value)} aria-label={t("Kind")}>
        {Object.entries(detailLabels(t)).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <input className="input min-w-28 flex-1" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("Value")} />
      <button className="btn btn-sm">{t("Add")}</button>
    </form>
  );
}

const KINDS = ["birthday", "anniversary", "other"] as const;

/** A date to add: birthday, anniversary or another (what for), the day. */
function AddDatePart(p: PartProps) {
  const t = useT();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("birthday");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const names = { birthday: t("Birthday"), anniversary: t("Anniversary"), other: t("Date") };
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!(await runPersonOp(rowOf(p), { op: "addDate", kind, date, label }))) return;
        setDate("");
        setLabel("");
      }}
    >
      <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} aria-label={t("Kind")}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {names[k]}
          </option>
        ))}
      </select>
      <input className="input w-36" required value={date} onChange={(e) => setDate(e.target.value)} placeholder={t("16.10. or 16.10.1996")} aria-label={t("Date")} />
      <input className="input min-w-28 flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("what for (other dates)")} aria-label={t("Label")} />
      <button className="btn btn-sm">{t("Add")}</button>
    </form>
  );
}

/** How many days before a confirmed date it reminds — saved on leaving it. */
function RemindPart(p: PartProps) {
  const t = useT();
  const id = Number(p.attrs.date);
  const days = Number(p.attrs.days) || 0;
  if (!id) return null;
  return <input key={`${id}:${days}`} type="number" min={0} max={60} defaultValue={days} className="input w-16 py-0.5 text-xs" aria-label={t("Days before to remind")} onBlur={(e) => Number(e.target.value) !== days && void runPersonOp(rowOf(p), { op: "dateRemind", id, days: Number(e.target.value) })} />;
}

/** A relation to add: what they are (mother, landlord), to you or to someone else. */
function AddRelationPart(p: PartProps) {
  const t = useT();
  const [rel, setRel] = useState("");
  const [other, setOther] = useState("0");
  const others = (p.app.others as { id: number; name: string }[] | undefined) ?? [];
  return (
    <form
      className="flex flex-wrap gap-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await runPersonOp(rowOf(p), { op: "addRelation", rel, other: Number(other) })) setRel("");
      }}
    >
      <input className="input min-w-0 flex-1" required value={rel} onChange={(e) => setRel(e.target.value)} placeholder={t("e.g. mother, landlord")} aria-label={t("Relation")} />
      <select className="input w-40" value={other} onChange={(e) => setOther(e.target.value)} aria-label={t("To whom")}>
        <option value="0">{t("to you")}</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {t("of {name}", { name: o.name })}
          </option>
        ))}
      </select>
      <button className="btn btn-sm">{t("Add")}</button>
    </form>
  );
}

/** An operation of a button; the thing it is about by value="…". */
const op = (env: ActionEnv, o: PersonOperation) => void runPersonOp(rowOf(env.props), o);
const idOf = (env: ActionEnv) => Number(env.attrs.value) || 0;

/** An operation that takes a while: "…" on its button meanwhile (state.busy). */
const slow = (key: string, o: PersonOperation) => async (env: ActionEnv) => {
  env.setState("busy", key);
  try {
    await runPersonOp(rowOf(env.props), o);
  } finally {
    env.setState("busy", "");
  }
};

/** The knowledge's entries of them merged — or not the same; what the knowledge knows read again. */
const knowledge = (what: "merge" | "dismiss") => async (env: ActionEnv) => {
  const r = await personKnowledgeMergeAction(rowOf(env.props), idOf(env), what);
  if (!r.ok) return void toast(r.error, { tone: "error" });
  if (what === "merge") toast(env.t("Merged in the knowledge."));
  env.reloadApp();
};

const page: ViewAppModule = {
  parts: {
    "person.input": InputPart,
    "person.timeline": TimelinePart,
    "person.note": NotePart,
    "person.transfer": TransferPart,
    "person.addDetail": AddDetailPart,
    "person.addDate": AddDatePart,
    "person.remind": RemindPart,
    "person.addRelation": AddRelationPart,
  },
  useAppData: usePersonPage,
  actions: {
    "person.star": (env) => op(env, { op: "star", on: !env.app.starred }),
    "person.compile": slow("compile", { op: "compile" }),
    "person.findDates": slow("findDates", { op: "findDates" }),
    "person.right": (env) => op(env, { op: "review", what: "claim", id: idOf(env), action: "confirm" }),
    "person.wrong": (env) => op(env, { op: "review", what: "claim", id: idOf(env), action: "reject" }),
    "person.done": (env) => op(env, { op: "review", what: "claim", id: idOf(env), action: "done" }),
    "person.dateRight": (env) => op(env, { op: "dateConfirm", id: idOf(env) }),
    "person.dateWrong": (env) => op(env, { op: "dateDelete", id: idOf(env) }),
    "person.copy": (env) => void navigator.clipboard.writeText(env.attrs.value ?? "").then(() => toast(env.t("Copied."))),
    "person.call": (env) => env.attrs.value && void (window.location.href = `tel:${env.attrs.value}`),
    "person.removeDetail": (env) => {
      const d = (env.app.details as { id: number; key: string; value: string }[] | undefined)?.find((x) => x.id === idOf(env));
      if (d) op(env, { op: "detail", action: "remove", key: d.key, value: d.value });
    },
    "person.removeRelation": (env) => op(env, { op: "deleteRelation", id: idOf(env) }),
    "person.merge": (env) => idOf(env) && op(env, { op: "merge", keep: idOf(env) }),
    "person.delete": (env) => op(env, { op: "delete" }),
    "person.knowledgeMerge": knowledge("merge"),
    "person.knowledgeDismiss": knowledge("dismiss"),
  },
};
export default page;
