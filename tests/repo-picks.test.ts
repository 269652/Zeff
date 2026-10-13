import assert from "node:assert/strict";
import { test } from "node:test";
import { fitSources, prioritizeLines, systemsTable, verifyPicks } from "@/plugins/knowledge/repo-picks";

const sources = [
  { title: "Domains & DNS", space: "S", summary: null, lines: ["| Notes | https://wiki.example/x |", "Staging | https://test-www.example.de/", "Production | https://www.example.de | live", "Mail: https://mail.example.de."] },
];

test("verifyPicks keeps only addresses that stand in the sources, once each, Prod first", () => {
  const picks = verifyPicks(
    {
      systems: [
        { env: "test", label: "Stage", url: "https://test-www.example.de", sure: true },
        { env: "prod", label: "Website", url: "https://www.example.de", sure: false },
        { env: "prod", label: "again", url: "https://WWW.example.de/", sure: true },
        { env: "dev", label: "invented", url: "https://dev.example.de", sure: true },
        { env: "weird", label: "Mail", url: "https://mail.example.de", sure: true },
      ],
    },
    sources,
  );
  assert.deepEqual(
    picks.map((p) => [p.env, p.url, p.sure]),
    [
      ["prod", "https://www.example.de", false],
      ["test", "https://test-www.example.de/", true],
      ["other", "https://mail.example.de", true],
    ],
  );
});

test("verifyPicks survives nonsense answers", () => {
  assert.deepEqual(verifyPicks(null, sources), []);
  assert.deepEqual(verifyPicks({ systems: "x" }, sources), []);
  assert.deepEqual(verifyPicks({ systems: [null, { url: 5 }] }, sources), []);
});

test("systemsTable: a row per system, a ? where the AI wasn't sure, no table without systems", () => {
  const head = { env: "Environment", system: "System", address: "Address" };
  const name = { prod: "Prod", test: "Test / Stage", dev: "Dev", other: "Other" };
  assert.equal(systemsTable([], head, name), "");
  const md = systemsTable([{ env: "prod", label: "Site | main", url: "https://www.example.de/", sure: false }], head, name);
  assert.match(md, /\| Environment \| System \| Address \|/);
  assert.match(md, /\| Prod \| Site \/ main \(\?\) \| \[www\.example\.de\]\(https:\/\/www\.example\.de\/\) \|/);
});

test("lines saying which system it is come first; sources are cut to the budget", () => {
  assert.deepEqual(prioritizeLines(["a https://x", "Staging https://y", "b https://z"]), ["Staging https://y", "a https://x", "b https://z"]);
  const many = Array.from({ length: 4 }, (_, i) => ({ title: `P${i}`, space: "S", summary: null, lines: ["Prod https://x/" + i] }));
  assert.equal(fitSources("", many, 1e6).length, 4);
  assert.equal(fitSources("", many, 80).length, 2);
});
