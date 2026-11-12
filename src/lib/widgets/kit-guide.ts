/**
 * How to write exercise sets for the kit (spec.ts) — what an AI that builds exercises reads (German, as Zeff's prompts are): the Learn
 * teachers' rules, and the plugin API's workspace.widgets.guide. Pure.
 */
export const KIT_GUIDE = `  Am besten als Übungssatz: spec = { title, intro?, items: [...] } — der eingebaute Baukasten zeigt eine Aufgabe nach der anderen, gibt sofort Rückmeldung, Tipp-Knopf (hint), zweiter Versuch, danach die Lösung und deine Erklärung (explain), am Ende Auswertung mit „Die falschen nochmal üben“, und meldet alles von selbst (Punkte, Antworten, fertig). Fehler im Satz kommen als Fehlermeldung mit jeder Stelle zurück — korrigieren und neu schicken. Text überall mit **fett**, \`Code\` und $Mathe$.
  Jede Aufgabe: { type, q: "die Aufgabe", hint?, explain?, media?: "<svg …>" (eigene Zeichnung, kein Netz), points? } und je nach type:
  · choice: options: [..], answer: 1 (Index) oder [0, 2] (mehrere richtig), why?: [Erklärung je Option]
  · number: answer: 9.81, tol?: 0.05 (absolut) oder rel?: 0.02 (2 %), unit?: "m/s^2", units?: { "cm/s^2": 0.01 } (umrechenbare Einheiten)
  · text: answer: "Photosynthese" oder ["…", "…"], match?: "loose" (Standard: Groß/klein, Akzente, ein Tippfehler) | "keywords" (alle Begriffe müssen vorkommen — für Erklärungen in eigenen Worten, long: true) | "regex" | "exact"
  · formula: answer: "2*x*cos(x^2)", vars?: ["x"] — als Funktion verglichen (2x·cos(x²) = cos(x^2)*2x zählt)
  · cloze: text: "Das {{Mitochondrium|Mitochondrion}} ist das Kraftwerk der {{[Wurzel|*Zelle|Blüte]}}."
  · order: items: [in richtiger Reihenfolge] (Abläufe: Arbeitsschritte auf der Baustelle, Notfallschema, Algorithmus, Unterrichtsphasen)
  · match: pairs: [["Eiche", "Quercus"], …]   · categorize: groups: { "Laubbaum": [..], "Nadelbaum": [..] }
  · hotspot: image: "<svg viewBox…>…</svg>", spots: [{ label: "Herzspitze", x: 40, y: 70 }] (x, y in % des Bildes) — Beschriften: Anatomie, Baumteile, Bauteile, Schaltplan
  · slider: min, max, answer, tol?, unit? (Schätzen)   · table: columns, rows mit Zellen { answer } zum Ausfüllen (Wertetabellen, Mengen, Kalkulation)
  · plot: fn: "a*sin(b*x)", params: { a: { min: 0, max: 3 }, b: {…} }, target?: { a: 2, b: 1 } (Kurve auf die gestrichelte bringen; ohne target: frei erkunden)
  · code: starter?: "function add(a, b) {\\n}", tests: [{ call: "add(2, 3)", expect: 5 }] (JavaScript, läuft sicher im Browser)
  · scenario: nodes: { start: { text, choices: [{ label, to: "b", feedback? }] }, …, gut: { text, end: true, score: 1 } } — Entscheidungen in echten Situationen: Klassenführung, Triage, Gefährdung im Wald, Arbeitsschutz
  · cards: cards: [{ front, back }] (Selbstabfrage)
  Wähle den Typ nach dem Fach: Rechnen → number/formula/table/plot; Begriffe → text/cloze/match/categorize; Abläufe → order; Zeichnungen → hotspot; Handeln und Entscheiden (Lehramt, Medizin, Handwerk, Forst) → scenario; Programmieren → code. Mische 4–8 Aufgaben, vom Leichten zum Schweren.`;
