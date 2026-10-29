"use client";

import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { addFoundFeedAction, findFeedsAction } from "./server-actions";

type Found = { url: string; title: string; items: number; newest: string; sample: string[]; domain: string; via: string; why: string; topic: string };

/**
 * The feed finder: name a topic (or leave it empty for your interests) and Zeff searches the internet for feeds worth
 * reading — publishers from a news search, outlets an AI suggests — each one fetched and checked, with a reason and
 * its latest headlines, one click to add.
 */
export function FeedFinder() {
  const t = useT();
  const [topic, setTopic] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const search = () =>
    start(async () => {
      setError("");
      const r = await findFeedsAction(topic);
      if (!r.ok) setError(r.error ?? t("Didn't work."));
      setFound(r.found);
    });
  const add = async (f: Found) => {
    const r = await addFoundFeedAction(f.url, f.title);
    if (r.ok) setAdded((cur) => new Set(cur).add(f.url));
    else toast(r.error ?? t("Didn't work."), { tone: "error" });
  };

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input value={topic} aria-label={t("Feed topic")} onChange={(e) => setTopic(e.target.value)} placeholder={t("A topic, e.g. quantum computing — or empty for my interests")} className="min-w-[16rem] flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <button className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? t("Searching the internet …") : t("Find feeds")}
        </button>
      </form>
      {pending && <p className="text-xs text-zinc-500">{t("Looking up who writes about it, asking the AI for outlets, and checking each site's feeds — about 20 seconds.")}</p>}
      {error && <p role="alert" className="alert-error text-sm">{error}</p>}
      {found && !pending && found.length === 0 && !error && <p className="text-sm text-zinc-500">{t("Found nothing new for that.")}</p>}
      {found && found.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {found.map((f) => (
            <li key={f.url} className="flex flex-wrap items-start gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1 basis-72">
                <div className="font-medium">
                  {f.title} <span className="text-xs font-normal text-zinc-500">{f.domain}{f.via === "ai" ? ` · ${t("suggested by the AI")}` : ""}</span>
                </div>
                <p className="text-xs text-zinc-500">{f.why}</p>
                <p className="line-clamp-2 text-xs text-zinc-400">{f.sample.join(" · ")}</p>
              </div>
              {added.has(f.url) ? (
                <span className="text-xs text-emerald-600">✓ {t("added")}</span>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => void add(f)}>
                  + {t("Add")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
