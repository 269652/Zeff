"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { saveLookupConfig } from "./config";

const key = (fd: FormData, k: string) => (typeof fd.get(k) === "string" && String(fd.get(k)).trim() ? String(fd.get(k)) : undefined);

/** Settings → Lookups: the keys. One left empty stays as it is (they are never shown again). */
export async function saveLookupsAction(fd: FormData): Promise<void> {
  saveLookupConfig({ tmdbKey: key(fd, "tmdbKey"), googleKey: key(fd, "googleKey") });
  revalidatePath("/settings/lookups");
  redirect(`/settings/lookups?ok=${encodeURIComponent(t("Saved."))}`);
}

/** To the Lookups plugin (to-plugin.ts): the keys carried over, the plugin on, this built-in off. */
export async function switchLookupsToPluginAction(): Promise<void> {
  let msg: string;
  let ok = true;
  try {
    const { switchLookupsToPlugin } = await import("./to-plugin");
    const r = await switchLookupsToPlugin();
    msg = r.keys.length ? t("Lookups runs as a plugin now; your keys came along.") : t("Lookups runs as a plugin now.");
  } catch (e) {
    ok = false;
    msg = errorMessage(e);
  }
  revalidatePath("/", "layout");
  redirect(ok ? `/plugins?ok=${encodeURIComponent(msg)}` : `/settings/lookups?error=${encodeURIComponent(msg)}`);
}

/** One search at TMDB to see the key works. */
export async function testTmdbAction(): Promise<void> {
  let msg: string;
  let ok = true;
  try {
    const { lookupSearch } = await import("@/plugins/workspace/lambdas/run");
    const hits = await lookupSearch("tmdb.movies", "Dune", "de-DE");
    msg = hits.length ? `${t("It works")}: ${hits.slice(0, 3).map((h) => h.title).join(" · ")}` : t("No results — the key works, the search found nothing.");
  } catch (e) {
    ok = false;
    msg = errorMessage(e);
  }
  redirect(`/settings/lookups?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`);
}
