// Dry run: both stages of a repo's summary against the live knowledge server, nothing stored. npx tsx scripts/dry-repo-systems.mts [repo name]
import { listRepos } from "../src/lib/repos";
import { composeRepo } from "../src/plugins/knowledge/repo-systems";

const want = process.argv[2];
const repos = listRepos();
for (const r of repos.filter((x) => !want || x.name === want)) {
  const t0 = Date.now();
  const out = await composeRepo(r, repos);
  console.log(`\n=== ${r.name} (${out.pages} pages, ${Math.round((Date.now() - t0) / 1000)}s)`);
  console.log(JSON.stringify(out.systems, null, 1));
  console.log(out.summary);
}
