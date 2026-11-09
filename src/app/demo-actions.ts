"use server";

import { accountById } from "@/db/accounts";
import { slugOf } from "@/lib/account-routes";
import { errorMessage } from "@/lib/errors";

/**
 * An account's own address ("/demo/todos", the first account's "/standard/…"): always with its prefix — the browser keeps
 * the tab's account for an unprefixed address (and a redirect), so a switch is a page load of the other's address, as the
 * account switcher does it.
 */
const under = (id: string, path: string) => {
  const a = accountById(id);
  return a ? `/${slugOf(a)}${path}` : path;
};

type Go = { ok: true; href: string } | { ok: false; error: string };

/** Into the demo (sample data, made the first time): where to go — its todos. */
export async function startDemoAction(): Promise<Go> {
  try {
    const id = await (await import("@/lib/demo")).startDemo();
    return { ok: true, href: under(id, "/todos") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Out of the demo, into your own Zeff (its setup assistant when it isn't set up yet): where to go. */
export async function leaveDemoAction(): Promise<Go> {
  try {
    const id = await (await import("@/lib/demo")).leaveDemo();
    return { ok: true, href: under(id, "/") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
