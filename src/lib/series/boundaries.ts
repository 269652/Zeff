import { allows, currentClearance, maxLabel, sourceLabel, type Clearance, type Label } from "@/lib/boundaries";
import { labelResolver } from "@/plugins/workspace/sensitivity";

/**
 * The correlations and the data boundaries (lib/boundaries): a series carries the label of what it is read from — a Workspace
 * database's fields its database's (a journal: personal by default), Zeff's signals their sources' (messages per channel, the
 * bank's spending: personal by default; the first and last activity of a day is read from the chats, Teams and booked time,
 * so it carries the strictest of them). Secret series are left out for every reader, you too; personal ones are there for you
 * and for the agents whose routine may read personal data — the same rules as the MCP guard. Server only.
 */

/** The sources each of Zeff's own series is read from, by the start of its id. */
const SIGNAL_SOURCES: [string, string[]][] = [
  ["calendar:", ["calendar"]],
  ["time:", ["time"]],
  // Mail: Outlook's and Gmail's (one table).
  ["messages:mail:", ["mail", "gmail"]],
  ["messages:whatsapp:", ["whatsapp"]],
  ["messages:signal:", ["signal"]],
  ["messages:teams:", ["teams"]],
  ["todos:", ["todos"]],
  ["finances:", ["bank"]],
  // Sleep: a sleep tracker's calendar (the Calendar plugin's series).
  ["sleep:", ["sleep"]],
  ["activity:", ["whatsapp", "signal", "teams", "time"]],
  ["people:", ["whatsapp", "signal", "mail", "gmail", "teams", "calendar"]],
];

/** A labeller of series ids for one batch (the databases' labels read once). Another plugin's series: open. */
export function seriesLabeller(): (id: string) => Label {
  const dbs = labelResolver();
  return (id) => {
    const db = /^db:(\d+):/.exec(id);
    if (db) return dbs.database(Number(db[1]));
    const sources = SIGNAL_SOURCES.find(([prefix]) => id.startsWith(prefix))?.[1];
    return sources ? maxLabel(...sources.map(sourceLabel)) : "open";
  };
}

/** Only the series a reader with this clearance (default: the code running's) may see. */
export function visibleSeries<S extends { id: string }>(list: S[], clearance: Clearance = currentClearance()): S[] {
  const label = seriesLabeller();
  return list.filter((s) => allows(clearance, label(s.id)));
}
