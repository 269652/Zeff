"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HoverCard, useHoverSide } from "@/components/HoverCard";
import { useT } from "@/components/I18nProvider";
import { formatDateTime } from "@/lib/format";
import { isChatFolder } from "@/lib/mail/shared";
import { mentionMatcher, splitMentions, splitTags, type PersonIndexEntry } from "./mentions";
import { personCardAction, type PersonCardData } from "./server-actions";

/**
 * People named in texts (todos): the names as links to their profile, with a hover card — who they
 * are, their next dates, what Zeff knows of them, their latest messages, the todos naming them.
 * The index comes from the layout (the People plugin installed); without it, texts stay plain.
 */
const Ctx = createContext<ReturnType<typeof mentionMatcher>>(null);

/** Where each person's page is (their row in the people database), by profile id. */
const Hrefs = createContext<Record<number, string>>({});
const useHref = (id: number) => useContext(Hrefs)[id] ?? "/workspace";

export function PeopleProvider({ index, hrefs = {}, children }: { index: PersonIndexEntry[]; hrefs?: Record<number, string>; children: ReactNode }) {
  const matcher = useMemo(() => mentionMatcher(index), [index]);
  return (
    <Hrefs.Provider value={hrefs}>
      <Ctx.Provider value={matcher}>{children}</Ctx.Provider>
    </Hrefs.Provider>
  );
}

/** A text with the people named in it as links; the rest as `render` makes it. */
export function PersonText({ text, render = (s) => s }: { text: string; render?: (s: string) => ReactNode }) {
  const matcher = useContext(Ctx);
  if (!matcher) return <>{render(text)}</>;
  return (
    <>
      {splitMentions(text, matcher).map((m, i) =>
        m.person ? (
          <PersonMention key={i} id={m.person.id} name={m.person.name}>
            {m.text}
          </PersonMention>
        ) : (
          <span key={i}>{render(m.text)}</span>
        ),
      )}
    </>
  );
}

/**
 * A note's text with the people tagged in it (@Name) underlined — their hover card on hover; the rest as `render` makes it.
 */
export function TaggedText({ text, render = (s) => s }: { text: string; render?: (s: string) => ReactNode }) {
  const matcher = useContext(Ctx);
  if (!matcher || !text.includes("@")) return <>{render(text)}</>;
  return (
    <>
      {splitTags(text, matcher).map((m, i) =>
        m.person ? (
          <PersonMention key={i} id={m.person.id} name={m.person.name} tagged>
            {m.text}
          </PersonMention>
        ) : (
          <span key={i}>{render(m.text)}</span>
        ),
      )}
    </>
  );
}

/**
 * A name as a link to the person, with their hover card — or, inside another hover card (a note's), their card
 * as its sidebar: the two become one split view. `tagged`: an @-tag in a note — underlined solid.
 */
/** The people tagged (@) in a text — each once, in the order they're named. */
export function useTaggedPeople(text: string): { id: number; name: string }[] {
  const matcher = useContext(Ctx);
  return useMemo(() => {
    if (!matcher || !text.includes("@")) return [];
    const seen = new Map<number, { id: number; name: string }>();
    for (const m of splitTags(text, matcher)) if (m.person && !seen.has(m.person.id)) seen.set(m.person.id, { id: m.person.id, name: m.person.name });
    return [...seen.values()];
  }, [matcher, text]);
}

type Named = { id: number; name: string };

/** The people a note tags, for the names in it: hovering one opens a sidebar with all of them, that one in front. */
const GroupCtx = createContext<Named[] | null>(null);
export const PeopleGroup = ({ people, children }: { people: Named[]; children: ReactNode }) => <GroupCtx.Provider value={people.length ? people : null}>{children}</GroupCtx.Provider>;

/** The people a note names as a swipeable carousel (scroll-snap) — the sidebar of the note's hover card; `focus` is the one in front. */
function PeopleCarousel({ people, focus }: { people: Named[]; focus: number }) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(Math.max(0, people.findIndex((p) => p.id === focus)));
  const go = (i: number, smooth = true) => track.current?.scrollTo({ left: i * track.current.clientWidth, behavior: smooth ? "smooth" : "auto" });
  useEffect(() => {
    const i = people.findIndex((p) => p.id === focus);
    if (i >= 0) go(i, track.current !== null && track.current.scrollLeft > 0);
  }, [focus, people]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={track}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
      >
        {people.map((p) => (
          <div key={p.id} className="w-full shrink-0 snap-start overflow-y-auto">
            <PersonCard id={p.id} name={p.name} flat />
          </div>
        ))}
      </div>
      {people.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 border-t border-zinc-200 py-1.5 dark:border-zinc-800">
          {people.map((p, i) => (
            <button key={p.id} type="button" title={p.name} aria-label={t("Show {name}", { name: p.name })} aria-current={i === at} onClick={() => go(i)} className={`size-2 rounded-full ${i === at ? "bg-teal-500" : "bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PersonMention({ id, name, children, tagged = false }: { id: number; name: string; children: ReactNode; tagged?: boolean }) {
  const href = useHref(id);
  const side = useHoverSide();
  const group = useContext(GroupCtx);
  const underline = tagged
    ? "underline decoration-teal-500/80 underline-offset-2 hover:text-teal-700 dark:hover:text-teal-300"
    : "underline decoration-zinc-400/70 decoration-dotted underline-offset-2 hover:text-teal-700 hover:decoration-teal-500 dark:hover:text-teal-300";
  if (side) {
    // The sidebar shows only once a name is hovered: the people the text tags (the one hovered in front), else just this one.
    const show = () => {
      side.setSide(<PeopleCarousel people={group?.some((p) => p.id === id) ? group : [{ id, name }]} focus={id} />);
      side.open();
    };
    return (
      <Link href={href} className={underline} onClick={(e) => e.stopPropagation()} onMouseEnter={show} onFocus={show}>
        {children}
      </Link>
    );
  }
  return (
    <HoverCard width={360} card={<PersonCard id={id} name={name} />}>
      <Link href={href} className={underline} onClick={(e) => e.stopPropagation()}>
        {children}
      </Link>
    </HoverCard>
  );
}

/** How much of a summary the card shows before "Show more". */
const SUMMARY_CHARS = 300;

/** The person's summary in their card: cut at about 300 characters with an ellipsis; "Show more" opens the rest and the facts. */
function SummaryBlock({ summary }: { summary: { connection: string; keyFacts: string[]; funFacts: string[] } }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = summary.connection.length > SUMMARY_CHARS;
  const cut = long ? `${summary.connection.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, "")}…` : summary.connection;
  const more = long || summary.keyFacts.length > 0 || summary.funFacts.length > 0;
  return (
    <div className="space-y-1.5 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/50">
      {summary.connection && <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-200">{open ? summary.connection : cut}</p>}
      {open && summary.keyFacts.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-zinc-600 dark:text-zinc-300">
          {summary.keyFacts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {open && summary.funFacts.length > 0 && (
        <ul className="space-y-0.5 text-zinc-600 dark:text-zinc-300">
          {summary.funFacts.map((f, i) => (
            <li key={i}>🎈 {f}</li>
          ))}
        </ul>
      )}
      {more && (
        <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("Show less") : t("Show more")}
        </button>
      )}
    </div>
  );
}

/** Loaded cards (for this page's life): a card opened again shows at once. */
const cache = new Map<number, PersonCardData | null>();

function PersonCard({ id, name, flat = false }: { id: number; name: string; flat?: boolean }) {
  const href = useHref(id);
  const t = useT();
  const [data, setData] = useState<PersonCardData | null | undefined>(cache.get(id));
  useEffect(() => {
    if (cache.has(id)) return;
    let alive = true;
    personCardAction(id)
      .then((d) => {
        cache.set(id, d);
        if (alive) setData(d);
      })
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div className={flat ? "space-y-2 p-3 text-xs" : "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900"}>
      <div className="flex items-baseline justify-between gap-2">
        <Link href={href} className="text-sm font-semibold hover:underline">
          {data?.name ?? name}
        </Link>
        {!!data?.aliases.length && <span className="truncate text-zinc-400">{t("also: {names}", { names: data.aliases.slice(0, 4).join(", ") })}</span>}
      </div>
      {data === undefined && <p className="text-zinc-400">{t("Loading …")}</p>}
      {data === null && <p className="text-zinc-400">{t("Nothing known about them yet.")}</p>}
      {data && (
        <>
          {data.summary && <SummaryBlock summary={data.summary} />}
          {data.dates.length > 0 && (
            <ul className="space-y-0.5">
              {data.dates.map((d, i) => (
                <li key={i}>
                  🎂 <span className="font-medium">{d.label}</span> <span className="text-zinc-500">{d.when}</span>
                </li>
              ))}
            </ul>
          )}
          {data.facts.length > 0 && (
            <ul className="space-y-0.5">
              {data.facts.map((f, i) => (
                <li key={i}>
                  <span className="font-medium">{f.subject}:</span> <span className="text-zinc-600 dark:text-zinc-300">{f.text}</span>
                </li>
              ))}
            </ul>
          )}
          {data.relations.length > 0 && <p className="font-medium text-zinc-700 dark:text-zinc-200">{data.relations.join(" · ")}</p>}
          {data.note && <p className="line-clamp-3 whitespace-pre-line text-zinc-600 dark:text-zinc-300">{data.note}</p>}
          {data.owed.length > 0 && (
            <div className="space-y-0.5">
              <p className="font-semibold text-zinc-500 uppercase">{t("Open commitments")}</p>
              {data.owed.map((o, i) => (
                <p key={i} className="line-clamp-2">
                  <span className={o.direction === "mine" ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium text-sky-700 dark:text-sky-400"}>{o.direction === "mine" ? t("I owe") : t("They owe")}</span> {o.text}
                  {o.due && <span className="text-zinc-400"> · {o.due}</span>}
                </p>
              ))}
            </div>
          )}
          {data.claims.length > 0 && (
            <ul className="space-y-0.5">
              {data.claims.map((c, i) => (
                <li key={i} className="line-clamp-2 text-zinc-700 dark:text-zinc-200" title={c.confirmed ? undefined : t("Read from messages by the AI — not confirmed yet")}>
                  {c.text}
                  {!c.confirmed && <span className="text-zinc-400"> · AI</span>}
                </li>
              ))}
            </ul>
          )}
          {data.links.length > 0 && (
            <p className="flex flex-wrap gap-1">
              {data.links.map((l, i) => (
                <span key={i} className="rounded-full border border-zinc-200 px-1.5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                  {l}
                </span>
              ))}
            </p>
          )}
          {data.messages.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold text-zinc-500 uppercase">{t("Latest messages")}</p>
              {data.messages.map((m, i) => (
                <p key={i} className="line-clamp-2">
                  <span className="text-zinc-400">
                    {formatDateTime(m.at)} · {isChatFolder(m.folder) ? m.folder : t("Mail")} · {m.who}:
                  </span>{" "}
                  {m.text}
                </p>
              ))}
            </div>
          )}
          {data.todos.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold text-zinc-500 uppercase">{t("Open todos")}</p>
              {data.todos.map((x) => (
                <Link key={x.id} href={`/t/${x.id}`} className="line-clamp-1 hover:underline">
                  <span className="font-mono text-zinc-400">{x.ref}</span> {x.text}
                </Link>
              ))}
            </div>
          )}
          {!data.summary && !data.dates.length && !data.facts.length && !data.relations.length && !data.note && !data.messages.length && !data.todos.length && !data.claims.length && !data.links.length && !data.owed.length && <p className="text-zinc-400">{t("Nothing known about them yet.")}</p>}
        </>
      )}
    </div>
  );
}
