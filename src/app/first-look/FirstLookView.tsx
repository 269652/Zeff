"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { FirstLook } from "@/lib/first-look";
import { markPaidAction } from "@/plugins/workspace/actions";
import { caseTodoAction, firstLookSeenAction, promiseDoneAction, promiseTodoAction } from "./actions";

const euro = (v: number | null) => (v == null ? "" : v.toLocaleString(undefined, { style: "currency", currency: "EUR" }));
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" });

/** The first look: what Zeff found in the last 30 days, each with one click — done ones go from the page. */
export function FirstLookView({ look }: { look: FirstLook }) {
  const t = useT();
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => void firstLookSeenAction(), []);
  const act = async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    const r = await fn();
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setGone((g) => new Set(g).add(key));
    toast(done, { tone: "ok" });
  };
  const live = <T,>(list: T[], key: (x: T) => string) => list.filter((x) => !gone.has(key(x)));
  const promises = live(look.promises, (x) => `p:${x.id}`);
  const owed = live(look.owedToYou, (x) => `o:${x.id}`);
  const due = live(look.dueSoon, (x) => `d:${x.ref}`);
  const steps = live(look.noNextStep, (x) => `c:${x.caseId}`);
  const nothing = !promises.length && !owed.length && !due.length && !steps.length && !look.unbooked.days.length;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("Your first look")}</h1>
        <p className="text-zinc-500">{nothing ? t("Nothing slipped in the last 30 days — Zeff keeps watching.") : t("Zeff read the last 30 days and found {n} things worth a look. Each one is a click away.", { n: look.count })}</p>
      </header>

      {promises.length > 0 && (
        <Section icon="🤝" title={t("Promises you made and haven't kept")}>
          {promises.map((x) => (
            <Line key={x.id} text={x.text} sub={`${x.person}${x.due ? ` · ${t("due {day}", { day: day(x.due) })}` : ""}`}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void act(`p:${x.id}`, () => promiseTodoAction(x.id), t("A todo for it is on your list."))}>
                {t("Make it a todo")}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void act(`p:${x.id}`, () => promiseDoneAction(x.id), t("Marked as kept."))}>
                {t("Kept already")}
              </button>
            </Line>
          ))}
        </Section>
      )}

      {owed.length > 0 && (
        <Section icon="⏳" title={t("Promises made to you that are late")}>
          {owed.map((x) => (
            <Line key={x.id} text={x.text} sub={`${x.person}${x.due ? ` · ${t("due {day}", { day: day(x.due) })}` : ""}`}>
              <button type="button" className="btn btn-sm" onClick={() => void act(`o:${x.id}`, () => promiseTodoAction(x.id), t("A reminder is on your list."))}>
                {t("Remind me to ask")}
              </button>
            </Line>
          ))}
        </Section>
      )}

      {due.length > 0 && (
        <Section icon="📅" title={t("Due in the next 14 days")}>
          {due.map((x) => (
            <Line key={x.ref} text={x.title} sub={`${day(x.due)}${x.amount != null ? ` · ${euro(x.amount)}` : ""}`} late={x.due < new Date().toLocaleDateString("sv-SE")}>
              {x.href && (
                <Link href={x.href} className="btn btn-sm">
                  {t("Open")}
                </Link>
              )}
              {x.kind !== "todo" && (
                <button type="button" className="btn btn-sm" onClick={() => void act(`d:${x.ref}`, () => markPaidAction(x.ref, x.amount), t("Paid by hand."))}>
                  💶 {t("Mark as paid")}
                </button>
              )}
            </Line>
          ))}
        </Section>
      )}

      {steps.length > 0 && (
        <Section icon="📁" title={t("Cases with no next step")}>
          {steps.map((x) => (
            <Line key={x.caseId} text={x.title} sub={x.next}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void act(`c:${x.caseId}`, () => caseTodoAction(x.caseId), t("A todo for its next step is on your list."))}>
                {t("Make a todo")}
              </button>
              {x.href && (
                <Link href={x.href} className="btn btn-sm">
                  {t("Open")}
                </Link>
              )}
            </Line>
          ))}
        </Section>
      )}

      {look.unbooked.days.length > 0 && (
        <Section icon="⏱" title={t("Work time not booked")}>
          <p className="text-sm">
            {t("{hours} hours on {n} work days of the last 30 aren't booked.", { hours: look.unbooked.hours.toLocaleString(), n: look.unbooked.days.length })}{" "}
            <Link href="/feierabend" className="text-indigo-600 hover:underline dark:text-indigo-400">
              {t("Book them")} →
            </Link>
          </p>
          <p className="text-xs text-zinc-500">{look.unbooked.days.slice(-10).map((d) => `${day(d.date)}: ${d.missing.toLocaleString()} h`).join(" · ")}</p>
        </Section>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">
        <span aria-hidden>{icon}</span> {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Line({ text, sub, late, children }: { text: string; sub: string; late?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{text}</div>
        <div className={`text-xs ${late ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{sub}</div>
      </div>
      <div className="flex shrink-0 gap-1.5">{children}</div>
    </div>
  );
}
