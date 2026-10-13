import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/** The systems' addresses (Test / Prod …) come out of the pages that are about the work — with their environment, without documentation links. */
test("system links: environments from the labels and hosts, documentation left out", async () => {
  process.env.KNOWLEDGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-k-"));
  const { db } = await import("../knowledge/lib/db");
  const { systemLinks } = await import("../knowledge/lib/search");
  const body = [
    "PROJ Bundle project with TYPO3.",
    "Production |  https://www.example-ministry.de  |",
    "Staging |  https://test-www-example-ministry.public.example.net/",
    "Dev |  https://www-example-ministry-dev.example.com/  |",
    "This project uses DDEV for local development. Head over to the official DDEV documentation (https://ddev.readthedocs.io/en/stable/) to get instructions.",
    "Mail: support (mailto:support@example.com)",
  ].join("\n");
  const d = db();
  d.prepare("insert into pages (id, space, title, url, body, fetched_at) values ('p1', 'S', 'PROJ Bundle', 'https://wiki/p1', ?, '2026-01-01')").run(body);
  const c = d.prepare("insert into chunks (page_id, idx, heading, text) values ('p1', 0, '', ?)").run(body);
  d.prepare("insert into chunks_fts (title, heading, text, concepts, chunk_id, page_id) values ('PROJ Bundle', '', ?, '', ?, 'p1')").run(body, c.lastInsertRowid);
  const links = systemLinks("PROJ Bundle Relaunch Test", null);
  assert.deepEqual(
    links.map((l) => [l.env, l.url]),
    [
      ["prod", "https://www.example-ministry.de"],
      ["test", "https://test-www-example-ministry.public.example.net/"],
      ["dev", "https://www-example-ministry-dev.example.com/"],
    ],
  );
  assert.equal(links[0].pageTitle, "PROJ Bundle");
});
