import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** In a container the host's folders are mounted somewhere else: the paths Zeff keeps (the repos') are the host's, the ones it uses are the container's. */
test("the map: host path ⇄ container path, on the boundary of a folder, any slash, any case of the drive", async () => {
  const { parsePathMap, toLocalPath, toHostPath } = await import("@/lib/hostpath");
  const map = parsePathMap("C:\\Users\\me\\Documents=/host/documents;D:\\Work=/host/work");
  assert.deepEqual(map, [
    { host: "C:\\Users\\me\\Documents", local: "/host/documents" },
    { host: "D:\\Work", local: "/host/work" },
  ]);
  assert.equal(toLocalPath("C:\\Users\\me\\Documents\\PROJ\\repo", map), "/host/documents/PROJ/repo");
  assert.equal(toLocalPath("c:/users/me/documents/PROJ/repo/", map), "/host/documents/PROJ/repo");
  assert.equal(toLocalPath("C:\\Users\\me\\Documents", map), "/host/documents");
  assert.equal(toLocalPath("D:\\Work\\x", map), "/host/work/x");
  assert.equal(toLocalPath("C:\\Users\\me\\Documents2\\x", map), "C:\\Users\\me\\Documents2\\x", "another folder with the same beginning");
  assert.equal(toLocalPath("/already/local", map), "/already/local");
  assert.equal(toLocalPath("C:\\Users\\me\\Documents\\x", []), "C:\\Users\\me\\Documents\\x", "no map: as it is");
  assert.equal(toHostPath("/host/documents/PROJ/repo", map), "C:\\Users\\me\\Documents\\PROJ\\repo");
  assert.equal(toHostPath("/host/documents", map), "C:\\Users\\me\\Documents");
  assert.equal(toHostPath("/host/documents2/x", map), "/host/documents2/x");
  assert.equal(toHostPath("C:\\Users\\me\\Documents\\x", map), "C:\\Users\\me\\Documents\\x", "a host path stays");
  assert.deepEqual(parsePathMap(""), []);
  assert.deepEqual(parsePathMap("nonsense;=/x;C:\\a="), [], "pairs need both sides");
});

test("the repos: kept as the host's paths, used as the container's — saved either way", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hostpath-"));
  fs.mkdirSync(path.join(root, "PROJ", "proj", ".git"), { recursive: true });
  // (the map's local side is a posix path: the temp folder without its drive — on Windows that is the same drive's root, so the test runs there too)
  const posixRoot = root.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
  process.env.ZEFF_PATH_MAP = `C:\\Users\\me\\Documents=${posixRoot}`;
  const { getDb, schema } = await import("@/db");
  const { listRepos, saveRepo } = await import("@/lib/repos");
  getDb().insert(schema.repos).values({ name: "proj", path: "C:\\Users\\me\\Documents\\PROJ\\proj", gitlabProject: null, boards: "[]", tickets: "[]", instructions: "", delivery: "mr" }).run();
  const [repo] = listRepos();
  assert.equal(repo.path, `${posixRoot}/PROJ/proj`, "used as the container's path");
  // Saved from the container's path: kept as the host's.
  assert.equal(repo.ok, true, "the folder is found where the container has it");
  saveRepo({ name: "proj", path: repo.path, gitlabProject: null, boards: [], tickets: [], instructions: "", delivery: "mr" }, repo.id);
  const raw = getDb().select().from(schema.repos).all()[0];
  assert.equal(raw.path, "C:\\Users\\me\\Documents\\PROJ\\proj");
  delete process.env.ZEFF_PATH_MAP;
});
