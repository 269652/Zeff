"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HoverCard } from "@/components/HoverCard";
import { useT } from "@/components/I18nProvider";
import { formatDateTime } from "@/lib/format";
import { mentionMatcher, splitMentions, type PersonIndexEntry } from "./mentions";
import { personCardAction, type PersonCardData } from "./server-actions";

/**
 * People named in texts (todos): the names as links to their profile, with a hover card — who they
 * are, their next dates, what Zeff knows of them, their latest messages, the todos naming them.
 * The index comes from the layout (the People plugin installed); without it, texts stay plain.
 */
const Ctx = createContext<ReturnType<typeof mentionMatcher>>(null);

export function PeopleProvider({ index, children }: { index: PersonIndexEntry[]; children: ReactNode }) {
  const matcher = useMemo(() => mentionMatcher(index), [index]);
  return <Ctx.Provider value={matcher}>{children}</Ctx.Provider>;
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

/** A name as a link to the person, with their hover card. */
export function PersonMention({ id, name, children }: { id: number; name: string; children: ReactNode }) {
  return (
    <HoverCard width={360} card={<PersonCard id={id} name={name} />}>
      <Link href={`/personen/${id}`} className="underline decoration-zinc-400/70 decoration-dotted underline-offset-2 hover:text-teal-700 hover:decoration-teal-500 dark:hover:text-teal-300" onClick={(e) => e.stopPropagation()}>
        {children}
      </Link>
    </HoverCard>
  );
}

/** Loaded cards (for this page's life): a card opened again shows at once. */
const cache = new Map<number, PersonCardData | null>();

function PersonCard({ id, name }: { id: number; name: string }) {
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
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/personen/${id}`} className="text-sm font-semibold hover:underline">
          {data?.name ?? name}
        </Link>
        {!!data?.aliases.length && <span className="truncate text-zinc-400">{t("also: {names}", { names: data.aliases.slice(0, 4).join(", ") })}</span>}
      </div>
      {data === undefined && <p className="text-zinc-400">{t("Loading …")}</p>}
      {data === null && <p className="text-zinc-400">{t("Nothing known about them yet.")}</p>}
      {data && (
        <>
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
          {data.note && <p className="line-clamp-3 whitespace-pre-line text-zinc-600 dark:text-zinc-300">{data.note}</p>}
          {data.messages.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold text-zinc-500 uppercase">{t("Latest messages")}</p>
              {data.messages.map((m, i) => (
                <p key={i} className="line-clamp-2">
                  <span className="text-zinc-400">
                    {formatDateTime(m.at)} · {m.folder === "WhatsApp" ? "WhatsApp" : t("Mail")} · {m.who}:
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
          {!data.dates.length && !data.facts.length && !data.note && !data.messages.length && !data.todos.length && <p className="text-zinc-400">{t("Nothing known about them yet.")}</p>}
        </>
      )}
    </div>
  );
}
