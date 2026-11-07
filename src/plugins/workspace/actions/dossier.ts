"use server";

import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { run } from "./shared";

// ---------------------------------------------------------------------------
// A database as a body of knowledge: <ask> and <dossier> in a view
// ---------------------------------------------------------------------------

const needLlm = () => {
  if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
};

/** A question answered from the rows, naming them. */
export async function askDatabaseAction(dbId: number, question: string) {
  return run(async () => {
    needLlm();
    const r = await (await import("../dossier")).askDatabase(Number(dbId), String(question ?? ""));
    return r.answer ? r : { answer: t("Nothing here matches — try other words."), sources: r.sources };
  });
}

/** The dossier as it is, and how far a run is. */
export async function dossierAction(dbId: number) {
  return run(async () => {
    const { dossierJob, dossierOf } = await import("../dossier");
    return { dossier: dossierOf(Number(dbId)), job: dossierJob(Number(dbId)) };
  });
}

/** The dossier brought up to date, in the background. */
export async function compileDossierAction(dbId: number, focus?: string) {
  return run(async () => {
    needLlm();
    (await import("../dossier")).startDossier(Number(dbId), focus === undefined ? undefined : String(focus));
    return {};
  });
}
