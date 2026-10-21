import { runAi } from "@/lib/ai";
import { clip } from "@/lib/text";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { visibleClaims } from "./graph";
import { circleLabels } from "./shared";
import { contactsOf, datesOf, getPerson, relationsOf } from "./store";

/**
 * A birthday greeting drafted for someone (the People plugin): from what Zeff knows of them — what they are to you, what
 * connects you, a few facts, how you write to each other — short and personal, in German. You send it yourself. Server only.
 */

const SCHEMA = { type: "object", required: ["text"], properties: { text: { type: "string", description: "Der Glückwunsch, fertig zum Abschicken: 1–4 Sätze, Du oder Sie wie in den Nachrichten, ohne Platzhalter." } } };

export async function greetingDraft(personId: number): Promise<string> {
  if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
  const p = getPerson(personId);
  if (!p) throw new Error(t("Unknown person."));
  const birthday = datesOf(p.id).find((d) => d.kind === "birthday" && d.confirmed);
  const age = birthday?.year ? new Date().getFullYear() - birthday.year : null;
  const rel = relationsOf(p.id).out.map((r) => r.rel);
  const lines = [
    `Schreib einen Geburtstagsgruß von mir an ${p.name}${age ? ` (wird ${age})` : ""}.`,
    "Persönlich und warm, kurz — wie eine Nachricht, die ich selbst schreiben würde. Nichts erfinden: nur, was unten steht, darf vorkommen. Keine Floskelketten, höchstens ein Emoji.",
    "",
    ...(p.circle ? [`Was sie für mich ist: ${circleLabels(t)[p.circle]}`] : []),
    ...(rel.length ? [`Beziehung: ${rel.join(", ")}`] : []),
    ...(p.compiled?.connection ? [`Was uns verbindet: ${clip(p.compiled.connection, 600)}`] : []),
    ...(p.compiled?.funFacts.length ? ["Persönliches:", ...p.compiled.funFacts.map((f) => `- ${f}`)] : []),
    ...visibleClaims(p.id)
      .filter((c) => c.kind !== "commitment")
      .slice(0, 6)
      .map((c) => `- ${clip(c.text, 160)}`),
    "",
    "So schreiben wir uns (die letzten Nachrichten, die neuesten zuerst):",
    ...contactsOf(p, 6).map((c) => `- ${c.who}: ${clip(c.text, 160)}`),
  ];
  const r = await runAi<{ text: string }>(lines.join("\n").slice(0, 8000), SCHEMA, { task: "people-greeting", timeoutMs: 2 * 60000, maxBudgetUsd: 0.1 });
  return clip(r.output?.text, 1200);
}
