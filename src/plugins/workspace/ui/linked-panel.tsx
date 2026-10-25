"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { linksAction, markPaidAction, undoPaidAction } from "../actions";

type Thing = { ref: string; title: string; href: string | null; settledBy: { subject: string; label: string; todoId: number | null; at: string }[]; pay: number | null };
type Links = { things: Thing[]; todos: { id: number; ref: string; text: string; due: string | null }[] };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });

/**
 * What hangs together with a row (its debt, its case) or a todo (what it settles): each thing with what settled it and when — a
 * todo, a booking, "paid" by hand — the open todos that would settle it, and "Mark as paid" for a thing that can be paid (its
 * instalment to start with, yours to change; undone from the toast). Nothing when nothing hangs on it (lib/boards/todo-settle.ts).
 */
export function LinkedPanel({ target, onChanged }: { target: { rowId: number } | { todoId: number }; onChanged?: () => void }) {
  const t = useT();
  const [links, setLinks] = useState<Links | null>(null);
  const [paying, setPaying] = useState<{ ref: string; amount: string } | null>(null);
  const key = "rowId" in target ? `row:${target.rowId}` : `todo:${target.todoId}`;
  const load = useCallback(() => {
    void linksAction(target).then((r) => setLinks(r.ok ? { things: r.things, todos: r.todos } : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the target by its key
  }, [key]);
  useEffect(load, [load]);
  if (!links || (!links.things.length && !links.todos.length)) return null;
  const pay = async (ref: string, amount: string) => {
    const n = Number(amount.replace(",", "."));
    const r = await markPaidAction(ref, Number.isFinite(n) && n > 0 ? n : null);
    setPaying(null);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    load();
    onChanged?.();
    toast(t("Paid by hand."), {
      tone: "ok",
      action: {
        label: t("Undo"),
        run: async () => {
          const u = await undoPaidAction(r.key);
          if (!u.ok) toast(u.error, { tone: "error" });
          load();
          onChanged?.();
        },
      },
    });
  };
  return (
    <section className="my-4 space-y-2 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t("Hangs together with")}</h4>
      <ul className="space-y-2">
        {links.things.map((x) => (
          <li key={x.ref} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {x.href ? (
                <Link href={x.href} className="font-medium hover:underline">
                  {x.title}
                </Link>
              ) : (
                <span className="font-medium">{x.title}</span>
              )}
              <span className="flex-1" />
              {x.pay != null &&
                (paying?.ref === x.ref ? (
                  <span className="flex items-center gap-1">
                    <input className="input w-24 text-sm" inputMode="decimal" value={paying.amount} aria-label={t("Amount")} autoFocus onChange={(e) => setPaying({ ref: x.ref, amount: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void pay(x.ref, paying.amount)} />
                    €
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void pay(x.ref, paying.amount)}>
                      ✓
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setPaying(null)} aria-label={t("Cancel")}>
                      ✕
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => setPaying({ ref: x.ref, amount: String(x.pay).replace(".", ",") })}>
                    💶 {t("Mark as paid")}
                  </button>
                ))}
            </div>
            {x.settledBy.length > 0 && (
              <ul className="space-y-0.5 pl-3 text-xs text-zinc-500">
                {x.settledBy.map((s) => (
                  <li key={s.subject}>
                    ✓ {t("Done by")}{" "}
                    {s.todoId ? (
                      <Link href={`/t/${s.todoId}`} className="hover:underline">
                        {s.label}
                      </Link>
                    ) : (
                      s.label
                    )}{" "}
                    · {day(s.at)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {links.todos.length > 0 && (
        <div className="space-y-0.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">{t("Open todos")}</div>
          {links.todos.map((x) => (
            <Link key={x.id} href={`/t/${x.id}`} className="block truncate hover:underline">
              <span className="text-zinc-400">{x.ref}</span> {x.text}
              {x.due && <span className="text-zinc-400"> · {day(x.due)}</span>}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
