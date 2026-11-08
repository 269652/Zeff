"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { createLambdaAction, lambdasAction } from "../server-actions";
import { LambdaIDE } from "./LambdaIDE";

/**
 * The lambdas: Zeff's own (the lookups' sources — TMDB, Wikipedia, Open Library, Google, the web search) and yours, each a Node.js
 * function with its code, its manifest and its npm packages; one picked opens in the IDE. A new one starts as a lookup (a source a
 * view's <lookup> can search) or a function (any JSON in, JSON out — a flow's lambda.invoke).
 */

type Item = { name: string; label: string; what: string; kind: "lookup" | "function"; builtin: boolean; changed: boolean; missing: string | null };

export function Lambdas({ initial }: { initial: string | null }) {
  const t = useT();
  const [list, setList] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(initial);
  // (The list folds while a lambda is open: the IDE takes the room.)
  const [listing, setListing] = useState(!initial);
  const load = useCallback(() => void lambdasAction().then((r) => r.ok && setList(r.lambdas)), []);
  useEffect(load, [load]);

  const make = async () => {
    const name = window.prompt(t("Name of the new lambda (lowercase, dots — a lookup's source id)"), "my.source");
    if (!name) return;
    const kind = window.confirm(t("A lookup (a source a view's <lookup> searches)? Cancel: a function (JSON in, JSON out).")) ? "lookup" : "function";
    const r = await createLambdaAction(name, kind);
    if (!r.ok) return toast(r.error, { tone: "error" });
    load();
    setOpen(r.lambda.manifest.name);
    setListing(false);
  };

  return (
    <div className={`grid gap-3 ${listing ? "lg:grid-cols-[15rem_minmax(0,1fr)]" : ""}`}>
      <div className="space-y-2" hidden={!listing}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("Lambdas")}</h2>
          <button type="button" className="btn btn-sm" onClick={() => void make()}>
            + {t("Lambda")}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t("Node.js functions with their own npm packages, each in a sandbox; a lookup lambda is a source a view's <lookup> searches.")}</p>
        {(["builtin", "own"] as const).map((group) => (
          <div key={group}>
            <div className="label">{group === "builtin" ? t("Zeff's") : t("Yours")}</div>
            <ul className="space-y-0.5">
              {list
                .filter((l) => l.builtin === (group === "builtin"))
                .map((l) => (
                  <li key={l.name}>
                    <button type="button" className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${open === l.name ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} title={l.what} onClick={() => (setOpen(l.name), setListing(false))}>
                      <span aria-hidden className="font-mono text-xs text-zinc-500">
                        {l.kind === "lookup" ? "🔎" : "λ"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{l.label}</span>
                        <span className="block truncate font-mono text-[11px] text-zinc-500">
                          {l.name}
                          {l.changed ? ` · ${t("changed")}` : ""}
                        </span>
                      </span>
                      {l.missing && <span className="size-2 shrink-0 rounded-full bg-amber-500" title={l.missing} />}
                    </button>
                  </li>
                ))}
              {group === "own" && !list.some((l) => !l.builtin) && <li className="px-2 text-xs text-zinc-500">{t("None yet: + Lambda, or duplicate one of Zeff's.")}</li>}
            </ul>
          </div>
        ))}
      </div>
      <div className="min-w-0">{open ? <LambdaIDE key={open} name={open} onChanged={load} onOpen={(n) => (load(), setOpen(n || null), setListing(!n))} onList={listing ? undefined : () => setListing(true)} /> : <p className="text-sm text-zinc-500">{t("Pick a lambda to see its code, test it and change it.")}</p>}</div>
    </div>
  );
}
