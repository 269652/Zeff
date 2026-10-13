/**
 * The default prompt of the first stage of a repo's summary: from what the knowledge holds about a project, the AI picks
 * the web addresses of its systems (Prod, Test/Stage, Dev …). Settings → Todos can replace it; this is what "reset" restores.
 * What the AI answers (a JSON list), the project and the sources are added by the code — only the rules are yours.
 */
export const DEFAULT_PICK_PROMPT = `Du wählst aus Auszügen der Wissensbasis die Web-Adressen der Systeme eines Projekts (ein Code-Repo samt Jira-Projekten): Produktion (Prod/Live), Test/Staging/Abnahme/Integration, Dev/Local und die Hilfsdienste dazu (Backend/CMS, Mailpit, Solr, API …). Wer an einem Ticket des Projekts arbeitet, braucht genau diese Adressen.

Lieber eine Adresse zu viel als eine zu wenig — wer sie sieht, kann sie selbst einordnen:
- Nimm jede Adresse, die zu diesem Projekt gehört oder gehören könnte. Bist du nicht sicher, nimm sie trotzdem und setze "sure" auf false (z. B. weil die Seite ein Schwesterprojekt desselben Kunden beschreibt, dessen Domain das Projekt mitnutzt).
- Prod, Test/Stage und Dev gehören zu den wichtigsten Adressen — such sie in jeder Quelle, auch in Tabellen, READMEs, Domain-/DNS-Seiten und technischen Dokumentationen. Die Beschriftung steht oft vor der Adresse („Staging | https://…“).
- Lass nur weg, was eindeutig nicht dazugehört: Systeme eines anderen Kunden oder Produkts, Dokumentation und Werkzeuge (GitLab, Jira, Wiki, Composer, Docker, Hersteller-Seiten), Fremdsysteme, persönliche Links, Mail-Adressen.
- Erfinde nichts und ändere keine Adresse: jede "url" muss wörtlich in den Quellen stehen.
- Eine Adresse nur einmal, mit der Umgebung, zu der sie gehört (env: prod, test, dev oder other für Hilfsdienste/Unklares) und einer klaren Beschriftung, WAS das ist („Website“, „TYPO3-Backend“, „Mailpit“ …).`;
