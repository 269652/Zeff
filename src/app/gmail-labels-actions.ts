"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** The Gmail labels kept as folders of their own in Zeff (the inbox always is): what the mail settings page edits. */

/** The labels to keep, by name: each once, none made up (a name Gmail doesn't have is told). */
export async function saveGmailLabelsAction(text: string): Promise<ActionState> {
  try {
    const names = [...new Set(String(text ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 40);
    let unknown: string[] = [];
    try {
      const { gmailLabels } = await import("@/lib/google/gmail-write");
      const have = new Map((await gmailLabels()).map((l) => [l.name.toLowerCase(), l.name]));
      unknown = names.filter((n) => !have.has(n.toLowerCase()));
      for (let i = 0; i < names.length; i++) names[i] = have.get(names[i].toLowerCase()) ?? names[i];
    } catch {
      // not signed in to Google's API: the names are kept as typed
    }
    const { setPref } = await import("@/lib/prefs");
    const { GMAIL_LABELS_PREF } = await import("@/lib/mail/sync");
    setPref(GMAIL_LABELS_PREF, names.filter((n) => !unknown.includes(n)));
    revalidateAll();
    return unknown.length
      ? { ok: false, error: t("Gmail has no label called {names} — the others are saved.", { names: unknown.join(", ") }) }
      : { ok: true, message: names.length ? t("Saved. The labels come as folders with the next mail sync.") : t("Saved. Only the inbox is mirrored.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The names of Gmail's labels (to pick from), without the system ones. */
export async function gmailLabelNamesAction(): Promise<string[]> {
  try {
    const { gmailLabels } = await import("@/lib/google/gmail-write");
    return (await gmailLabels()).filter((l) => l.type !== "system" && !/^CATEGORY_/.test(l.id)).map((l) => l.name).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
