// Event hook: work.run.finished (see docs/plugins/hooks.md).
//   stdin   one line of JSON: { event, plugin, account, at, data: { run } }
//   env     ZEFF_API_URL, ZEFF_EXT_TOKEN, ZEFF_ACCOUNT … (the API: docs/plugins/api.md)
// What it does: appends a line per finished run to finished.log (in this plugin's folder — the working
// directory of a hook), and for a run that failed, adds a todo so it isn't forgotten.
import fs from "node:fs";

const event = JSON.parse(fs.readFileSync(0, "utf8"));
const run = event.data.run;

// Zeff's own runs (replies, merge requests) are noise here.
if (run.provider === "zeff") process.exit(0);

fs.appendFileSync(
  "finished.log",
  `${event.at}  ${run.ref}  ${run.status}${run.outcome ? `/${run.outcome}` : ""}  ${run.ticket || "-"}  ${run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : ""}\n`,
);

if (run.status === "failed") {
  const res = await fetch(`${process.env.ZEFF_API_URL}/api/ext/v1/todos.add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZEFF_EXT_TOKEN}`,
      "x-zeff-account": process.env.ZEFF_ACCOUNT,
    },
    body: JSON.stringify({ ticket: run.ticket || undefined, text: `Look at ${run.ref}: ${(run.error || "it failed").replace(/\s+/g, " ").slice(0, 150)}` }),
  });
  const answer = await res.json();
  if (!answer.ok) {
    console.error(`todos.add: ${answer.error.message}`);   // shows in the log on the Plugins page
    process.exit(1);
  }
}
