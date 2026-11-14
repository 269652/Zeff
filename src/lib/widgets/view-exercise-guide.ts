/**
 * How an AI writes an exercise in Zeff's view language (the middle of the three kinds — exercise set, view exercise, own widget): what the
 * teacher of a lesson reads (workspace.widgets.guide → views). German, like the rest of what the teacher reads. Client-safe.
 */
export const VIEW_EXERCISE_GUIDE = `DREI ARTEN VON ÜBUNGEN — wähle pro Übung:
1. Übungssatz (spec): Standardaufgaben — Auswahl, Zahl, Lückentext, Zuordnen, Reihenfolge … Am zuverlässigsten; nimm ihn, wenn er passt.
2. Übung in der Ansichts-Sprache (view): mehrstufige oder verzweigte Aufgaben, Tabellen zum Ausfüllen, Schieberegler mit berechneter
   Rückmeldung, Fälle mit Entscheidungen, Zwischenergebnisse, die geprüft werden. Wird vor dem Anzeigen geprüft: jeder Fehler kommt mit
   Zeilennummer zurück — korrigiere und sende neu.
3. Eigenes Widget (html + libs): Simulationen, 3D, Zeichnen, Physik, Animation, Formeln mit KaTeX — alles, was Code braucht.

ANSICHTS-SPRACHE FÜR ÜBUNGEN (view): HTML-ähnliche Tags, Werte in {{ … }}.
- Zustand: <state name="x" value=""/> (Vorgabe), lesen mit {{ state.x }}. Eingaben setzen ihn:
  <input bind="x" type="number|text" label="…" placeholder="…"/>, <select bind="x" options="a:Erste, b:Zweite"/>,
  <slider bind="x" min=0 max=10 step=0.5 label="…" unit="cm"/>, <toggle bind="x" label="…"/>, <tabs bind="x" options="…"/>.
- Rechnen: Formeln in {{ … }} — + - * / ^, abs, round(x, 2), sqrt, min, max, toNumber(s), if(bedingung, a, b), and/or/not, == != < >.
  Eigene Funktionen: <def name="nah" args="x, y" value="abs(toNumber(x) - y) < 0.01"/>, dann {{ nah(state.a, 3.5) }}.
- Zeigen: <heading level=2|3>, <text>, <markdown value="**fett**, Listen, \`code\`"/> (kein LaTeX — Formeln als Text oder Unicode: x², √, ·),
  <callout tone=good|warn|bad|info title="…">…</callout>, <tile label="…" value="{{ … }}"/>, <progress value= max=/>, <badge>, <chip>,
  Layout: <row gap=2>, <col>, <grid cols=2>, <box title="…">, <hr/>.
- Bedingt: {{#if state.x == 3}}…{{#else}}…{{/if}}; Listen: {{#each …}}…{{/each}}.
- Schritte: eine Zustandsvariable für den Schritt (<state name="s" value="1"/>), {{#if state.s == 1}}…{{/if}},
  weiter mit <button action="state" state="s" value="2" label="Weiter"/>.
- ERGEBNIS (Pflicht): <button action="report" score="{{ … }}" correct="{{ … }}" total=3 feedback="…" finished=true label="Abgeben"
  variant=primary/> — score 0..1; finished=true, wenn die Übung zu Ende ist. Das Ergebnis landet wie bei Widgets bei dir im Chat und in
  den Versuchen. Ohne diesen Knopf wird die Übung nicht angenommen.

BEISPIEL:
<state name="a" value=""/>
<def name="nah" args="x, y" value="abs(toNumber(x) - y) < 0.01"/>
<heading level=3>Skalarprodukt</heading>
<text>Berechne u · v für u = (1, 2, 3) und v = (4, 0, −1).</text>
<input bind="a" type="number" label="u · v ="/>
{{#if state.a}}{{#if nah(state.a, 1)}}<callout tone=good title="Richtig">1·4 + 2·0 + 3·(−1) = 1</callout>{{#else}}<callout tone=warn title="Noch nicht">Komponentenweise multiplizieren, dann addieren.</callout>{{/if}}{{/if}}
<button action="report" score="{{ if(nah(state.a, 1), 1, 0) }}" correct="{{ if(nah(state.a, 1), 1, 0) }}" total=1 feedback="Antwort: {{ state.a }}" finished=true label="Abgeben" variant=primary/>
`;
