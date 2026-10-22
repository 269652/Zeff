"use server";

import { errorMessage } from "@/lib/errors";
import type { TplError } from "./view-template";

/**
 * Views written by the AI: a wish ("the fixed costs on top", "a view of only the bailiff's debts") turned into a view template —
 * from the language's reference, the app's parts and actions, the database's properties and a few of its rows, the template now. What
 * it writes is drawn once against the rows; with errors it is asked once more, with them.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
export type ViewChatTurn = { role: "user" | "assistant"; text: string };

const SCHEMA = {
  type: "object",
  properties: {
    template: { type: "string", description: "Die vollständige Vorlage der Ansicht (nur die Tags der Referenz)." },
    note: { type: "string", description: "Ein, zwei Sätze für den Nutzer: was du geändert oder gebaut hast." },
  },
  required: ["template", "note"],
};

export async function viewTemplateAiAction(v: { dbId: number; app: string; current: string; request: string; history?: ViewChatTurn[] }): Promise<Result<{ template: string; note: string; errors: TplError[] }>> {
  try {
    const { getDatabase, rowsOf } = await import("./store");
    const { viewAppMeta, TEMPLATE_VIEW } = await import("./view-apps");
    const { renderView, viewReference } = await import("./view-template");
    const { cellText } = await import("./model");
    const db = getDatabase(Number(v.dbId));
    if (!db) throw new Error("The database is gone.");
    const data = rowsOf(db.page.id);
    const rows = data?.rows ?? [];
    const schema = db.schema;
    const meta = viewAppMeta(String(v.app)) ?? TEMPLATE_VIEW;
    const widgets = await (async () => {
      try {
        return (await import("./widgets")).widgetCatalog();
      } catch {
        return [];
      }
    })();
    const props = schema.properties
      .map((p) => `- ${p.name} (${p.type}${p.options?.length ? `: ${p.options.map((o) => o.name).join(", ")}` : ""})`)
      .join("\n");
    const sample = rows
      .slice(0, 5)
      .map((r) => `- ${r.title || "(ohne Titel)"}: ${schema.properties.map((p) => `${p.name}=${cellText(p, r.cells[p.id]).slice(0, 60)}`).filter((x) => !x.endsWith("=")).join("; ")}`)
      .join("\n");
    const prompt = (extra = "") =>
      [
        "Du schreibst die Vorlage einer Ansicht einer Datenbank in Zeff (einer persönlichen Arbeits-App) — in der Vorlagensprache unten, nichts sonst.",
        "Antworte mit der VOLLSTÄNDIGEN Vorlage (nicht nur dem geänderten Teil) und einer kurzen Notiz, was du getan hast.",
        "Halte dich streng an die Tags, Filter und Aktionen der Referenz. Beschriftungen in der Sprache des Nutzers (meist Deutsch). Nutze die Teile (parts) der App, wo sie passen; baue Neues aus den Tags.",
        "Gute Ansichten: oben das Wichtigste (Kennzahlen als <tile> in einem <grid>), dann die Zeilen (Liste, Karten oder Tabelle), Aktionen als Buttons; auf dem Handy gut lesbar (grid passt sich an).",
        "",
        viewReference(meta.parts, meta.actions),
        meta.appData ? `\nAPP-DATEN (app.*): ${meta.appData}` : "",
        widgets.length ? `\nWIDGETS: ${widgets.map((w) => `${w.id} (${w.label}${w.settings.length ? `; ${w.settings.map((s) => `${s.key}=${s.kind}${s.options ? `[${s.options.map((o) => o.value).join("|")}]` : ""}`).join(", ")}` : ""})`).join("; ")}` : "",
        "",
        `DATENBANK „${db.page.title}“ — Titelspalte „${schema.titleName}“, Eigenschaften:`,
        props || "(keine)",
        `ZEILEN (${rows.length}, Beispiele):`,
        sample || "(keine)",
        "",
        `DIE VORLAGE JETZT${v.current.trim() ? "" : " (leer — baue eine neue)"}:`,
        v.current.trim() || meta.defaultTemplate,
        "",
        ...(v.history?.length ? ["BISHERIGES GESPRÄCH:", ...v.history.slice(-8).map((h) => `${h.role === "user" ? "Nutzer" : "Du"}: ${h.text}`), ""] : []),
        `WUNSCH DES NUTZERS: ${v.request}`,
        extra,
      ].join("\n");
    const { runAi } = await import("@/lib/ai");
    const check = (template: string) =>
      renderView(template, { rows, props: schema.properties, titleName: schema.titleName, state: {}, app: {}, db: { id: db.page.id, title: db.page.title } }, { parts: meta.parts, actions: meta.actions }).errors;
    let r = (await runAi<{ template: string; note: string }>(prompt(), SCHEMA, { task: "general" })).output;
    let errors = check(r.template ?? "");
    if (errors.length) {
      const again = (await runAi<{ template: string; note: string }>(prompt(`\nDEINE LETZTE VORLAGE HATTE FEHLER — behebe sie:\n${errors.map((e) => `Zeile ${e.line}: ${e.message}`).join("\n")}\n\n${r.template}`), SCHEMA, { task: "general" })).output;
      const errs = check(again.template ?? "");
      if (errs.length <= errors.length) {
        r = again;
        errors = errs;
      }
    }
    return { ok: true, template: String(r.template ?? "").trim(), note: String(r.note ?? ""), errors };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
