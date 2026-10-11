"use client";

import { startTransition, useId, useRef, useState, useTransition } from "react";
import { deleteContextFileAction, fetchImagesAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import {
  CONTEXT_KINDS,
  contextKindLabels,
  describeTeamsLink,
  isRemoteImage,
  kindOfUrl,
  ticketOfUrl,
  type ContextFileInfo,
  type ContextKind,
  type ContextLink,
} from "@/lib/contexts-shared";
import { imageTargets, mapImageTargets } from "@/lib/markdown";
import { gitlabLinkKey, gitlabTicket } from "@/lib/gitlab/shared";
import { teamsLinkKey } from "@/lib/teams/shared";
import { useT } from "@/components/I18nProvider";
import { useContextFormOptions } from "./ContextFormOptions";
import { useSyncedGitlabItems } from "./GitlabItemBadge";
import { PaperclipIcon } from "./icons";
import { base64File, MarkdownPasteField, pasteToken, type PastedImage } from "./MarkdownPasteField";
import { PersonCombobox } from "./PersonCombobox";
import { DragGrip, ExpandableSource } from "./SourceBadge";
import { SourcePicker, type Picked } from "./SourcePicker";
import { SubmitButton } from "./SubmitButton";
import { useSyncedTeamsMessages } from "./TeamsMessageBadge";
import { TicketCombobox } from "./TicketCombobox";
import { reorderClasses, useReorder } from "./useReorder";

export type ContextFormDefaults = {
  kind?: ContextKind;
  title?: string | null;
  author?: string | null;
  body?: string;
  links?: ContextLink[];
  date?: string | null;
  ticket?: string | null;
};

const emptyLink = (): ContextLink => ({ url: "", label: null });

/** Where a field's value came from: still the default (or the entry's), a pasted link, or typed here. */
type Source = "auto" | "link" | "user";

/**
 * Context being added. Linked sources — Teams messages, GitLab merge requests, comments,
 * branches (anything synced, shown as badges) — each become an item of their own; what's
 * written here (who wrote what and when — a mail, a note — with links and files) one more.
 * The first plain link tells what it is (Teams / Jira / mail), its ticket and date.
 * `fromEntry`: the default ticket and date are an entry's — they follow the entry
 * (followEntry) until changed here, and a Teams link's date replaces the entry's.
 */
export function useContextDraft(defaults: ContextFormDefaults = {}, { fromEntry = false, sources = true } = {}) {
  const t = useT();
  const initial = () => ({
    kind: defaults.kind ?? ("note" as ContextKind),
    title: defaults.title ?? "",
    author: defaults.author ?? "",
    body: defaults.body ?? "",
    links: defaults.links ?? [],
    date: defaults.date ?? "",
    ticket: defaults.ticket ?? "",
  });
  const initialFrom = () => ({
    kind: !!defaults.kind && defaults.kind !== "note",
    date: (!fromEntry && defaults.date ? "user" : "auto") as Source,
    ticket: (!fromEntry && defaults.ticket ? "user" : "auto") as Source,
  });
  const [v, setV] = useState(initial);
  const [from, setFrom] = useState(initialFrom);
  const [pasted, setPasted] = useState<PastedImage[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  // With the search, the note's fields wait for "+ Write a note".
  const [noteOpen, setNoteOpen] = useState(false);
  const [fetching, setFetching] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Links to synced Teams messages / GitLab items resolve to them — picked ones at once.
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const urls = v.links.map((l) => l.url.trim()).filter(Boolean);
  const teamsFound = useSyncedTeamsMessages(urls);
  const gitlabFound = useSyncedGitlabItems(urls);

  const resolvedOf = (url: string): Picked | null => {
    const u = url.trim();
    if (!u) return null;
    if (picked[u]) return picked[u];
    if (teamsFound[u]) return { source: "teams", teams: teamsFound[u]!, url: u };
    if (gitlabFound[u]) return { source: "gitlab", gitlab: gitlabFound[u]!, url: u };
    return null;
  };
  // Still asking whether a link is a synced source: saving waits for the answer.
  const resolving =
    sources &&
    v.links.some((l) => {
      const u = l.url.trim();
      return !!u && !picked[u] && ((!!teamsLinkKey(u) && !(u in teamsFound)) || (!!gitlabLinkKey(u) && !(u in gitlabFound)));
    });

  const set = (patch: Partial<ReturnType<typeof initial>>) => setV((x) => ({ ...x, ...patch }));
  /** Typed or picked here: the first link and the entry leave it alone from now on. */
  const edit = (patch: Partial<Pick<ReturnType<typeof initial>, "kind" | "date" | "ticket">>) => {
    setFrom((f) => ({
      kind: f.kind || patch.kind !== undefined,
      date: patch.date !== undefined ? "user" : f.date,
      ticket: patch.ticket !== undefined ? "user" : f.ticket,
    }));
    set(patch);
  };

  const setLink = (i: number, patch: Partial<ContextLink>) => {
    const next = { ...v, links: v.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) };
    const src = { ...from };
    // The first link tells what this is, and maybe its ticket and date.
    if (i === 0 && patch.url !== undefined) {
      const kind = kindOfUrl(patch.url);
      if (kind && !src.kind) next.kind = kind;
      const ticket = ticketOfUrl(patch.url);
      if (ticket && !next.ticket.trim()) {
        next.ticket = ticket;
        src.ticket = "link";
      }
      const date = kind === "teams" ? describeTeamsLink(patch.url).date : null;
      if (date && src.date !== "user") {
        next.date = date;
        src.date = "link";
      }
    }
    setV(next);
    setFrom(src);
  };
  const addLink = () => set({ links: [...v.links, emptyLink()] });
  const removeLink = (i: number) => set({ links: v.links.filter((_, j) => j !== i) });
  /** Some links in a new order (their places among the links, as dragged); the others stay where they are. */
  const reorderLinks = (order: number[]) =>
    setV((x) => {
      const links = [...x.links];
      [...order].sort((a, b) => a - b).forEach((slot, k) => (links[slot] = x.links[order[k]]));
      return { ...x, links };
    });

  /**
   * A synced Teams message or GitLab item added: its link joins the others (once) — saved, it's
   * an item of its own (the note keeps what it says it is). A Jira ticket it names fills an
   * empty ticket.
   */
  const addEntity = (p: Picked, ticket: string | null = null) => {
    if (v.links.some((l) => l.url.trim() === p.url)) return;
    setPicked((x) => ({ ...x, [p.url]: p }));
    const takeTicket = !!ticket && !v.ticket.trim();
    setV({
      ...v,
      ticket: takeTicket && ticket ? ticket : v.ticket,
      links: [...v.links.filter((l) => l.url.trim()), { url: p.url, label: null }],
    });
    if (takeTicket) setFrom((f) => ({ ...f, ticket: "link" }));
  };

  /** The entry's ticket or date changed: follow it, unless this one was set here or by a link. */
  const followEntry = (patch: { ticket?: string; date?: string }) =>
    setV((x) => ({
      ...x,
      ...(patch.ticket !== undefined && from.ticket === "auto" ? { ticket: patch.ticket } : {}),
      ...(patch.date !== undefined && from.date === "auto" ? { date: patch.date } : {}),
    }));

  /**
   * Download pictures the message only links to (pasted from GitLab, Jira…): each becomes a
   * pasted picture of its own — stored with the item when saved, attached in Jira.
   */
  const fetchImages = async (list: string[]) => {
    const todo = [...new Set(list)].filter(isRemoteImage);
    if (!todo.length) return;
    setFetching((n) => n + todo.length);
    setFetchError(null);
    try {
      const got = await fetchImagesAction(todo);
      const added: PastedImage[] = [];
      const local = new Map<string, string>();
      for (const g of got) {
        if (!g.ok) continue;
        const token = pasteToken();
        const file = base64File(g.data, g.name, g.mime);
        added.push({ token, file, url: URL.createObjectURL(file) });
        local.set(g.url, `paste:${token}`);
      }
      if (added.length) {
        setPasted((p) => [...p, ...added]);
        setV((x) => ({ ...x, body: mapImageTargets(x.body, (target) => local.get(target) ?? target) }));
      }
      const failed = got.filter((g) => !g.ok);
      if (failed.length) {
        const why = [...new Set(failed.map((f) => (f.ok ? "" : f.error)))].join(" · ");
        setFetchError(
          failed.length === 1
            ? t("A picture couldn't be fetched: {why}", { why })
            : t("{n} pictures couldn't be fetched: {why}", { n: failed.length, why }),
        );
      }
    } catch (e) {
      setFetchError(t("The pictures couldn't be fetched: {error}", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setFetching((n) => n - todo.length);
    }
  };

  /** Put the pasted pictures still in the message into the form data (stored as the item's files). */
  const addPastedTo = (fd: FormData, prefix = "") => {
    const used = new Set(imageTargets(v.body));
    const send = pasted.filter((p) => used.has(`paste:${p.token}`));
    send.forEach((p, i) => {
      fd.append(`${prefix}pasted-file-${i}`, p.file, p.file.name);
      fd.set(`${prefix}pasted-token-${i}`, p.token);
    });
    fd.set(`${prefix}pastedCount`, String(send.length));
  };

  /**
   * Fill in what goes along when saving: the pictures pasted into the message. (The linked
   * sources become items of their own on the server — who and when from each.)
   */
  const prepare = async (fd: FormData, prefix = "") => addPastedTo(fd, prefix);

  /** Saved: forget the pasted pictures and start over. */
  const reset = () => {
    pasted.forEach((p) => URL.revokeObjectURL(p.url));
    setPasted([]);
    setPicked({});
    setV(initial());
    setFrom(initialFrom());
    setFileNames([]);
    setNoteOpen(false);
    setFetchError(null);
  };

  // Something written for a note: its fields stay in view.
  const written = !!(v.title.trim() || v.body.trim() || v.author.trim() || fileNames.length || pasted.length);

  return {
    v,
    /** This form adds linked sources (the search); else it's just written (a note, a mail). */
    sources,
    set,
    edit,
    setLink,
    addLink,
    removeLink,
    reorderLinks,
    followEntry,
    addEntity,
    resolvedOf,
    /** A link is still being looked up. */
    resolving,
    pasted,
    onPasted: (images: PastedImage[]) => setPasted((p) => [...p, ...images]),
    /** The files picked to attach (their names). */
    fileNames,
    setFileNames,
    /** The note's fields are shown: always without the search; with it once asked for or written in. */
    noteShown: !sources || noteOpen || written,
    openNote: () => setNoteOpen(true),
    fetchImages,
    /** Pictures being downloaded right now — saving waits for them. */
    fetching,
    fetchError,
    /** Anything worth keeping: a message (pasted pictures are in it), a headline, a link or a file. */
    hasContent: !!(v.body.trim() || v.title.trim() || v.links.some((l) => l.url.trim()) || fileNames.length > 0),
    prepare,
    reset,
  };
}

export type ContextDraft = ReturnType<typeof useContextDraft>;

/** The forms' small text buttons ("+ Write a note", "+ Add a link", "Attach files"). */
const TEXT_BTN = "inline-flex cursor-pointer items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400";

/**
 * Context's fields, top to bottom: the search for Teams messages and GitLab items (`sources`;
 * each pick a badge with ×); a note's fields — where it's from, who wrote what and when (with
 * the search they wait for "+ Write a note"); other links; then the Jira ticket and the
 * buttons for more. `prefix` goes in front of every field name, for a form with fields of its
 * own (the entry form's "Add context"); `ticket={false}`: the ticket is the form's own
 * (posted along, not shown).
 */
export function ContextFields({
  draft: d,
  prefix = "",
  files = [],
  ticket: showTicket = true,
}: {
  draft: ContextDraft;
  prefix?: string;
  /** The item's stored files (editing), each removable. */
  files?: ContextFileInfo[];
  ticket?: boolean;
}) {
  const t = useT();
  // Colleagues and tickets to pick from (ContextFormOptionsProvider).
  const { people, tickets } = useContextFormOptions();
  // Several forms can be open at once (adding, editing a card): ids of their own.
  const uid = useId();
  const fid = (f: string) => `${uid}-${f}`;
  const field = (f: string) => `${prefix}${f}`;
  const fileInput = useRef<HTMLInputElement>(null);
  const { v } = d;
  // Jira keys GitLab items name count when their prefix is one you book ("PROJ").
  const ticketPrefixes = new Set(tickets.map((tk) => tk.ticket.split("-")[0].toUpperCase()));
  const linked = new Set(v.links.map((l) => l.url.trim()).filter(Boolean));
  const links = v.links.map((l, i) => ({ l, i, e: d.sources ? d.resolvedOf(l.url) : null }));
  const sources = links.filter((x) => x.e);
  const plain = links.filter((x) => !x.e);
  // The picked sources, dragged into the order they'll be on the entry in.
  const { rowFor } = useReorder(
    sources.map((x) => x.i),
    (order) => d.reorderLinks(order),
  );

  return (
    <div className="space-y-3">
      <input type="hidden" name={field("linkCount")} value={v.links.length} />

      {d.sources && <SourcePicker linked={linked} onPick={(p) => d.addEntity(p, p.source === "gitlab" ? gitlabTicket(p.gitlab, ticketPrefixes) : p.source === "todo" ? p.todo.ticket : null)} />}

      {sources.length > 0 && (
        <ul className="space-y-1.5">
          {sources.map(({ l, i, e }) => {
            const r = rowFor(i);
            return (
              <li key={l.url} {...r.row} className={`rounded-md ${reorderClasses(r)}`}>
                <input type="hidden" name={field(`link-url-${i}`)} value={l.url} />
                <input type="hidden" name={field(`link-label-${i}`)} value={l.label ?? ""} />
                <ExpandableSource
                  entity={e!}
                  before={sources.length > 1 ? <DragGrip {...r.grip} /> : null}
                  after={
                    <button type="button" className="icon-btn text-base" onClick={() => d.removeLink(i)} aria-label={t("Remove")} title={t("Remove")}>
                      ×
                    </button>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {d.noteShown ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_10rem]">
            <div>
              <label className="label" htmlFor={fid("kind")}>{t("From")}</label>
              <select id={fid("kind")} name={field("kind")} className="input" value={v.kind} onChange={(e) => d.edit({ kind: e.target.value as ContextKind })}>
                {CONTEXT_KINDS.map((k) => (
                  <option key={k} value={k}>{contextKindLabels(t)[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor={fid("author")}>{t("Who")}</label>
              <PersonCombobox id={fid("author")} name={field("author")} value={v.author ?? ""} onChange={(author) => d.set({ author })} people={people} />
            </div>
            <div>
              <label className="label" htmlFor={fid("date")}>{t("When")}</label>
              <input id={fid("date")} name={field("date")} type="date" className="input" value={v.date ?? ""} onChange={(e) => d.edit({ date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor={fid("title")}>{t("Headline")} <span className="font-normal text-zinc-400 normal-case">{t("(optional)")}</span></label>
            <input id={fid("title")} name={field("title")} className="input" placeholder={t("Scope of the content migration agreed")} value={v.title ?? ""} onChange={(e) => d.set({ title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <MarkdownPasteField
              id={fid("body")}
              name={field("body")}
              value={v.body}
              onChange={(body) => d.set({ body })}
              pasted={d.pasted}
              onPasted={d.onPasted}
              onRemoteImages={d.fetchImages}
            />
            <LinkedPictures draft={d} />
          </div>
        </>
      ) : (
        <>
          {/* What a plain link told (a Jira comment, a mail) goes along. */}
          <input type="hidden" name={field("kind")} value={v.kind} />
          <input type="hidden" name={field("date")} value={v.date ?? ""} />
        </>
      )}

      {plain.length > 0 && (
        <div className="space-y-1.5">
          {plain.map(({ l, i }) => (
            <div key={i} className="flex items-center gap-2">
              <input
                name={field(`link-url-${i}`)}
                className="input flex-[3]"
                placeholder={t("https://… — a Teams, GitLab or Jira link, a mail")}
                value={l.url}
                onChange={(ev) => d.setLink(i, { url: ev.target.value })}
                aria-label={t("Link {n}", { n: i + 1 })}
                autoFocus={!l.url}
              />
              <input
                name={field(`link-label-${i}`)}
                className="input flex-[2]"
                placeholder={t("label (optional)")}
                value={l.label ?? ""}
                onChange={(ev) => d.setLink(i, { label: ev.target.value })}
                aria-label={t("Link {n} label", { n: i + 1 })}
              />
              <button type="button" className="icon-btn text-base" onClick={() => d.removeLink(i)} aria-label={t("Remove link {n}", { n: i + 1 })} title={t("Remove")}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {d.resolving && <p className="text-xs text-zinc-500">{t("Looking up the link…")}</p>}

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <li key={f.id} className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
              📎 {f.name}
              <button
                type="button"
                className="text-zinc-400 hover:text-red-500"
                aria-label={t("Remove {name}", { name: f.name })}
                title={t("Remove {name}", { name: f.name })}
                onClick={() => {
                  if (!confirm(t("Remove {name}?", { name: f.name }))) return;
                  const fd = new FormData();
                  fd.set("id", String(f.id));
                  startTransition(() => deleteContextFileAction(fd));
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {showTicket ? (
          <div className="w-full sm:w-64">
            <label className="label" htmlFor={fid("ticket")}>{t("Jira ticket")}</label>
            <TicketCombobox
              id={fid("ticket")}
              name={field("ticket")}
              placeholder={t("PROJ-337 or words of its title")}
              value={v.ticket ?? ""}
              onChange={(ticket) => d.edit({ ticket })}
              suggestions={tickets}
            />
          </div>
        ) : (
          <input type="hidden" name={field("ticket")} value={v.ticket ?? ""} />
        )}
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${showTicket ? "sm:pb-2" : ""}`}>
          {!d.noteShown && (
            <button type="button" className={TEXT_BTN} onClick={d.openNote}>
              {t("+ Write a note")}
            </button>
          )}
          <button type="button" className={TEXT_BTN} onClick={d.addLink}>
            {t("+ Add a link")}
          </button>
          <button type="button" className={TEXT_BTN} onClick={() => fileInput.current?.click()}>
            <PaperclipIcon className="size-3.5" /> {t("Attach files")}
          </button>
          <input
            ref={fileInput}
            name={field("files")}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label={t("Files to attach")}
            onChange={(e) => d.setFileNames([...(e.target.files ?? [])].map((f) => f.name))}
          />
          {d.fileNames.length > 0 && (
            <span className="text-zinc-600 dark:text-zinc-300" title={d.fileNames.join("\n")}>
              📎 {d.fileNames.length === 1 ? d.fileNames[0] : t("{n} files", { n: d.fileNames.length })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pictures the message only links to (pasted from GitLab, Jira…): being fetched, or — when
 * that didn't work (not signed in there) — why, with a button to try again.
 */
function LinkedPictures({ draft: d }: { draft: ContextDraft }) {
  const t = useT();
  const linked = [...new Set(imageTargets(d.v.body).filter(isRemoteImage))];
  if (d.fetching > 0) {
    return (
      <p className="text-xs text-zinc-500" role="status">
        {d.fetching === 1 ? t("Fetching a picture…") : t("Fetching {n} pictures…", { n: d.fetching })}
      </p>
    );
  }
  if (!linked.length) return null;
  const hostOf = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  };
  const hosts = [...new Set(linked.map(hostOf))].join(", ");
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" role="status">
      <span className="text-amber-700 dark:text-amber-400">
        {linked.length === 1
          ? t("A picture links to {hosts} — not kept with the item yet.", { hosts })
          : t("{n} pictures link to {hosts} — not kept with the item yet.", { n: linked.length, hosts })}
      </span>
      <button type="button" className="btn btn-sm" onClick={() => d.fetchImages(linked)}>
        {linked.length === 1 ? t("Fetch it") : t("Fetch them")}
      </button>
      {d.fetchError && <span className="basis-full text-red-600 dark:text-red-400">{d.fetchError}</span>}
    </div>
  );
}

/**
 * Add or edit a context item on its own (an entry's Context section, the Context tab, a
 * card being edited). `fromEntry`: the defaults' ticket and date are the entry's.
 */
export function ContextForm({
  action: serverAction,
  defaults = {},
  files = [],
  submitLabel,
  onDone,
  fromEntry = false,
  sources = true,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: ContextFormDefaults;
  /** The item's stored files (editing), each removable. */
  files?: ContextFileInfo[];
  submitLabel?: string;
  onDone?: () => void;
  fromEntry?: boolean;
  /** Offer the Teams / GitLab search (each pick becomes an item of its own); off: just written — a note, a mail. */
  sources?: boolean;
}) {
  const t = useT();
  const draft = useContextDraft(defaults, { fromEntry, sources });
  const [state, setState] = useState<ActionState>(null);
  const [pending, startSaving] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.fetching || draft.resolving) return; // the pictures / the links being looked up go along once they're here
        const fd = new FormData(e.currentTarget);
        // Once saved: close (editing) or start a fresh one (adding).
        startSaving(async () => {
          await draft.prepare(fd);
          const result = await serverAction(null, fd);
          setState(result);
          if (!result?.ok) return;
          draft.reset();
          formRef.current?.reset();
          onDone?.();
        });
      }}
      className="space-y-3"
    >
      <ContextFields draft={draft} files={files} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-primary btn-sm" pendingText={draft.fetching ? t("Fetching pictures…") : t("Saving…")} pending={pending || draft.fetching > 0}>
          {submitLabel ?? t("Add context")}
        </SubmitButton>
        {onDone && (
          <button type="button" className="btn btn-sm" onClick={onDone}>
            {t("Cancel")}
          </button>
        )}
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && !onDone && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
