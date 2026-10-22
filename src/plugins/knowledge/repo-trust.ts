import { onTrustDecision, recordFact } from "@/lib/trust/store";
import { getRepoSystems, setRepoSystems, type RepoPick } from "./repo-systems-store";

/**
 * A project's systems with trust (the Knowledge plugin, server only): each address the AI picks from the knowledge is a
 * version of "repo:<id>" + "<env>-url" (@/lib/trust). A prod address other than the one that holds isn't put into the
 * summary — the one that holds stays there and the new one waits in the review queue; one you rejected or no longer
 * take isn't used again. Your answer has the summary written again on the next run.
 */

/** The picks as the summary uses them: what holds, a disputed one replaced by what it contradicts. */
export function trustPicks(repoId: number, repoName: string, picks: RepoPick[]): RepoPick[] {
  const out: RepoPick[] = [];
  const has = (url: string) => out.some((p) => p.url === url);
  for (const p of picks) {
    const r = recordFact({ subject: `repo:${repoId}`, subjectLabel: repoName, attribute: `${p.env}-url`, value: p.url, writer: "repo", payload: { label: p.label }, sourceRef: "knowledge", quote: p.label, confidence: p.sure ? 0.8 : 0.5 });
    if (r.version.status === "current") {
      if (!has(p.url)) out.push(p);
      continue;
    }
    // Contradicting what holds: what holds instead.
    if (r.outcome === "disputed")
      for (const c of r.current) if (!has(c.value)) out.push({ env: p.env, label: String((c.payload as { label?: string }).label ?? c.quote ?? ""), url: c.value, sure: true });
  }
  return out;
}

/** Your word on a project's address: its summary is written again on the next run (its basis no longer fits). */
onTrustDecision("repo", (changes) => {
  for (const id of new Set(changes.filter((c) => c.subject.startsWith("repo:")).map((c) => Number(c.subject.slice(5))))) {
    const have = getRepoSystems(id);
    if (have) setRepoSystems(id, { ...have, basis: "" });
  }
});
