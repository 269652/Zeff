/**
 * What a widget's result (or its breaking) says to the agent of the chat it belongs to — the exercise in a lesson: the teacher hears of how
 * it went and carries on by itself, hears of the error and sends a fixed one. German, like the agents' rules. Client-safe (pure).
 */
export type WidgetResultLike = { score: number; correct?: number; total?: number; note?: string; answers?: { q: string; a: string; ok?: boolean }[] };

export function resultMessage(title: string, r: WidgetResultLike, kind = "Widget"): string {
  const count = r.correct !== undefined && r.total ? `${r.correct} von ${r.total} richtig, ` : "";
  const note = r.note ? ` Notiz: ${r.note}` : "";
  const answers = r.answers?.length ? ` Antworten: ${r.answers.slice(0, 20).map((x, i) => `${i + 1}) ${x.q} → ${x.a}${x.ok === true ? " ✓" : x.ok === false ? " ✗" : ""}`).join("; ")}.` : "";
  return `[${kind} „${title}“ abgeschlossen: ${count}${Math.round(r.score * 100)} %.${note}${answers}] Besprich kurz, was nicht saß, und mach dann von selbst weiter mit dem nächsten Teil der Einheit (Erklärung, nächster Teil oder Abschluss) — frag nicht erst, ob es weitergehen soll.`;
}

export function errorMessage(title: string, message: string, kind = "Widget"): string {
  return `[${kind} „${title}“ hatte einen Fehler: ${message.slice(0, 300)}] Entschuldige dich in einem Satz und schick sofort eine korrigierte Fassung.`;
}
