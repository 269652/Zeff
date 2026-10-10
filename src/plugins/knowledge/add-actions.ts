"use server";

import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import { knowledgeAddOwn } from "./client";

/** Something to keep in the knowledge (your own, on this account's knowledge server): a text, or a link. */
export async function addKnowledgeAction(text: string): Promise<{ ok: boolean; error?: string; title?: string }> {
  if (!isInstalled("knowledge")) return { ok: false, error: "Knowledge is not installed (Menu → Plugins)." };
  try {
    const r = await knowledgeAddOwn({ text: String(text ?? "") });
    return { ok: true, title: r.entry?.title };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
