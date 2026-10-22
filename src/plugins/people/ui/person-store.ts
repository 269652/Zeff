"use client";

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "@/components/Toaster";
import { personBundleAction, personOpAction } from "../block-actions";
import type { PersonBundle, PersonOperation } from "../blocks";

/**
 * A person's bundle, one per row, read once however many ask — so a change made in one part of the page shows in the others. What the
 * server read with the page is shown at once.
 */

type Entry = { data: PersonBundle | null; error: string | null; loading: boolean };
const entries = new Map<number, Entry>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const EMPTY: Entry = { data: null, error: null, loading: true };

const seeded = new Map<number, number>();

/** What the server read with the page: shown at once (and not read again for a moment). */
export function seedPerson(rowId: number, data: PersonBundle) {
  entries.set(rowId, { data, error: null, loading: false });
  seeded.set(rowId, Date.now());
}

const inflight = new Map<number, Promise<void>>();

/** The bundle of a row read — once at a time (and an error is kept for a moment: a page that is no person is not asked again and again). */
export function loadPerson(rowId: number): Promise<void> {
  const running = inflight.get(rowId);
  if (running) return running;
  const p = personBundleAction(rowId)
    .then((r) => {
      entries.set(rowId, r.ok ? { data: r.person, error: null, loading: false } : { data: null, error: r.error, loading: false });
      if (!r.ok) seeded.set(rowId, Date.now());
      emit();
    })
    .finally(() => inflight.delete(rowId));
  inflight.set(rowId, p);
  return p;
}

/** The bundle of a row, read when shown (what was cached shows meanwhile) — unless the server just gave it with the page. */
export function usePersonEntry(rowId: number): Entry {
  const entry = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => entries.get(rowId) ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    if (rowId && Date.now() - (seeded.get(rowId) ?? 0) > 5000) void loadPerson(rowId);
  }, [rowId]);
  return entry;
}

/**
 * An operation on the profile; the bundle is read again. Gone (merged, deleted): the page goes where the server says (`go`: the
 * router's push; else the browser goes there).
 */
export async function runPersonOp(rowId: number, op: PersonOperation, opts: { done?: string; go?: (href: string) => void } = {}): Promise<boolean> {
  const r = await personOpAction(rowId, op);
  if (!r.ok) {
    toast(r.error, { tone: "error" });
    return false;
  }
  if (r.message) toast(r.message);
  else if (opts.done) toast(opts.done);
  if (r.gone) {
    entries.delete(rowId);
    const href = r.href ?? "/workspace";
    if (opts.go) opts.go(href);
    else window.location.assign(href);
    return true;
  }
  await loadPerson(rowId);
  return true;
}
