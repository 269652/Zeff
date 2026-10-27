import assert from "node:assert/strict";
import test from "node:test";
import type { SourceHealth } from "@/lib/sync/source-health-shared";

// The briefing says what it may not know: the sources it reads that aren't well, in its prompt (German) — none when all are well.
const h = (key: string, label: string, state: SourceHealth["state"], detail: SourceHealth["detail"]): SourceHealth =>
  ({ key, label, href: `/${key}`, state, since: null, detail, lastAt: null, lastOkAt: null, lastNewAt: "2026-10-26T10:00:00Z", baseline: null, perDay: null, everyMinutes: 5 }) as SourceHealth;

test("the prompt's notice: each source not up to date, why, its newest item — and what the AI must not read into it", async () => {
  const { gapNotice } = await import("@/lib/boards/lage-gaps");
  assert.deepEqual(gapNotice([]), []);
  const lines = gapNotice([h("teams", "Teams", "stale", { kind: "stale", overdueMin: 240, everyMinutes: 5 } as SourceHealth["detail"])]);
  assert.match(lines[0], /ACHTUNG — diese Quellen sind bei diesem Lauf nicht aktuell/);
  assert.match(lines[1], /^- Teams: .+ — .+\(Neuestes von dort: /);
  assert.match(lines.at(-1)!, /nicht als „noch nicht beantwortet“/);
});
