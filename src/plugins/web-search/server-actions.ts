"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/lib/redirect";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { canSearch, saveSearchConfig, webSearch } from "./search";

const text = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : undefined);

/** Settings → Web search: the provider and its keys. A key left empty stays as it is (they are never shown again). */
/** To the Web search plugin (to-plugin.ts): provider and keys carried over, the plugin on, this built-in off. */
export async function switchWebSearchToPluginAction(): Promise<void> {
  let msg: string;
  let ok = true;
  try {
    await (await import("./to-plugin")).switchWebSearchToPlugin();
    msg = t("Web search runs as a plugin now; your settings came along.");
  } catch (e) {
    ok = false;
    msg = errorMessage(e);
  }
  revalidatePath("/", "layout");
  redirect(ok ? `/plugins?ok=${encodeURIComponent(msg)}` : `/settings/web-search?error=${encodeURIComponent(msg)}`);
}

export async function saveWebSearchAction(fd: FormData): Promise<void> {
  const provider = text(fd, "provider") === "brave" ? "brave" : "google";
  saveSearchConfig({
    provider,
    ...(text(fd, "googleKey")?.trim() ? { googleKey: text(fd, "googleKey") } : {}),
    googleCx: text(fd, "googleCx") ?? "",
    ...(text(fd, "braveKey")?.trim() ? { braveKey: text(fd, "braveKey") } : {}),
  });
  revalidatePath("/settings/web-search");
  redirect(`/settings/web-search?ok=${encodeURIComponent(t("Saved."))}`);
}

/** One search to see it works — the first hits, or what went wrong. */
export async function testWebSearchAction(): Promise<void> {
  let msg: string;
  let ok = true;
  try {
    if (!canSearch()) throw new Error(t("Add the key first."));
    const hits = await webSearch("OpenAI API pricing per million tokens", { count: 3 });
    msg = hits.length ? `${t("It works")}: ${hits.map((h) => h.title).join(" · ")}` : t("No results — the key works, the search found nothing.");
  } catch (e) {
    ok = false;
    msg = errorMessage(e);
  }
  redirect(`/settings/web-search?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`);
}
