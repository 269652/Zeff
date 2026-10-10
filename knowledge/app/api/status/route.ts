import { NextResponse } from "next/server";
import { compileRunning, compileStopping, compilingWith } from "@k/compile";
import { confluenceWhere } from "@k/confluence";
import { counts, getSettings, lastRuns } from "@k/db";
import { syncRunning } from "@k/ingest";
import { unauthorized } from "@k/http";
import { installedKPlugins, kInstalled } from "@k/plugins";

export const dynamic = "force-dynamic";

/** How the knowledge base stands: pages, entities, the last runs, what's running, where it reads from (Confluence: only with its plugin). */
export function GET(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  return NextResponse.json({ counts: counts(), settings: getSettings(), confluence: kInstalled("confluence") ? confluenceWhere() : null, running: { sync: syncRunning(), compile: compileRunning(), stopping: compileStopping(), compilingWith: compilingWith() }, runs: lastRuns(8), plugins: [...installedKPlugins()] });
}
