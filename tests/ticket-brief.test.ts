import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { ROOT } from "./helpers";

// A coding agent's ticket brief: the ticket found by its key, a branch name or the repo folder; its acceptance criteria read
// from the description (Jira's "h2." headings and "# " numbered lists, Markdown).

test("the ticket from a key, a branch name, a repo folder's branch — none from words without a key", async () => {
  const { ticketFrom } = await import("@/lib/work/ticket-brief");
  assert.deepEqual(ticketFrom({ ticket: "proj-371" }), { key: "PROJ-371", via: "ticket" });
  assert.deepEqual(ticketFrom({ branch: "feature/PROJ-371-horizontale-einzel" }), { key: "PROJ-371", via: "branch feature/PROJ-371-horizontale-einzel" });
  assert.equal(ticketFrom({ branch: "main" }), null);
  // This checkout's branch names no ticket (master): none.
  assert.equal(ticketFrom({ cwd: ROOT })?.key ?? null, /[A-Z][A-Z0-9]+-\d+/.exec(execFileSync("git", ["-C", ROOT, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).toUpperCase())?.[0] ?? null);
});

test("acceptance criteria: the items under the heading, to the next heading — Jira's numbered list, Markdown bullets", async () => {
  const { acceptanceCriteria } = await import("@/lib/work/ticket-brief");
  const jira = ["h2. Lösung", "Ein Teaser quer.", "h2. Akzeptanzkriterien", "# Bild links, Inhalt rechts.", "# Auf Mobile vertikal.", "h2. Figma", "[link]"].join("\n");
  assert.deepEqual(acceptanceCriteria(jira), ["Bild links, Inhalt rechts.", "Auf Mobile vertikal."]);
  const md = ["## Acceptance criteria", "", "- loads in 1s", "- works offline", "", "## Notes", "x"].join("\n");
  assert.deepEqual(acceptanceCriteria(md), ["loads in 1s", "works offline"]);
  assert.deepEqual(acceptanceCriteria("Nur ein Text ohne Kriterien."), []);
});
