/** A widget's result as the message the teacher gets (client-safe; German, like the teacher's rules). */
import type { WidgetMessage } from "@/lib/widgets/sandbox";

export function resultMessage(title: string, r: Extract<WidgetMessage, { type: "result" }>): string {
  const count = r.correct !== undefined && r.total ? `${r.correct} von ${r.total} richtig, ` : "";
  const note = r.note ? ` Notiz der Übung: ${r.note}` : "";
  const answers = r.answers?.length ? ` Antworten: ${r.answers.slice(0, 20).map((x, i) => `${i + 1}) ${x.q} → ${x.a}${x.ok === true ? " ✓" : x.ok === false ? " ✗" : ""}`).join("; ")}.` : "";
  return `[Übung „${title}“ abgeschlossen: ${count}${Math.round(r.score * 100)} %.${note}${answers}] Besprich kurz, was nicht saß, und mach dann von selbst weiter mit dem nächsten Teil der Einheit.`;
}
