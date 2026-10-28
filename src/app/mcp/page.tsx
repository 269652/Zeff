import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { headers } from "next/headers";
import { accountById, accountsInstalled, currentAccountId, listAccounts } from "@/db/accounts";
import { accountToken } from "@/lib/account-tokens";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("MCP setup") };
}

const tools = (): [string, string][] => [
  ["report_time", t("Book hours on a job (jobNumber, hours, description, date?, ticket?, reportedBy?).")],
  ["todo_time_update", t("Correct a time record (TT-<id>: minutes or hours, note) — while it isn't booked or suggested.")],
  ["todo_time_delete", t("Delete a time record that shouldn't be there (TT-<id>) — while it isn't booked or suggested.")],
  ["todo_clock_start", t("Start the clock on a todo before you work on it (todo, agent) — Zeff notes the time; start_todo starts it too.")],
  ["todo_clock_ping", t("Keep a todo's clock running (todo, agent) — at least every 10 minutes, else it pauses as of the last ping.")],
  ["todo_clock_stop", t("Stop the clock when you stop working on it (todo, note, agent) — the difference is recorded as the todo's time, measured.")],
  ["todo_time", t("Report the time you spent on a todo (todo, minutes or hours, note, agent) — one record each, a todo can have many; they flow into its booking.")],
  ["list_jobs", t("List job numbers, optionally filtered by a search term.")],
  ["create_job", t("Create a new job number.")],
  ["get_weekly_report", t("Hours per job and weekday for a week, plus all its entries.")],
  ["list_time_entries", t("List entries with filters (job, date range, ticket, reporter).")],
  ["update_time_entry", t("Correct an entry.")],
  ["delete_time_entry", t("Delete an entry booked by mistake.")],
];

export default async function McpPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:9333";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  // One endpoint; the token says which account — this one's opens only it (another account's: at its address, Menu → MCP).
  const id = currentAccountId();
  const name = accountById(id)?.name ?? id;
  const url = `${proto}://${host}/api/mcp`;
  const others = accountsInstalled() ? listAccounts().filter((a) => a.id !== id) : [];
  const token = accountToken("mcp", id);
  const headerFlag = ` --header "Authorization: Bearer ${token}"`;
  const headersJson = `,\n      "headers": { "Authorization": "Bearer ${token}" }`;

  const claudeCli = `claude mcp add --transport http zeff ${url}${headerFlag}`;
  const mcpJson = `{
  "mcpServers": {
    "zeff": {
      "type": "http",
      "url": "${url}"${headersJson}
    }
  }
}`;
  const stdioJson = `{
  "mcpServers": {
    "zeff": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${url}", "--header", "Authorization: Bearer ${token}"]
    }
  }
}`;
  const curl = `curl -s ${url} -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "authorization: Bearer ${token}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Connect an agent")}</h1>
        <p className="text-sm text-zinc-500">
          {rich(
            t(
              "Zeff exposes a Model Context Protocol server over Streamable HTTP. Any MCP client can book time on jobs with the <code>report_time</code> tool.",
            ),
            { code: (s) => <code className="code">{s}</code> },
          )}
        </p>
      </div>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Endpoint")}</h2>
        <pre className="pre">{url}</pre>
        <p className="text-sm">
          {rich(t("Account “{name}”. Agents send its token — it opens this account only: <code>{header}</code>", { name, header: `Authorization: Bearer ${token}` }), { code: (s) => <code className="code break-all">{s}</code> })}
        </p>
        {others.length > 0 && (
          <p className="text-sm text-zinc-500">
            {t("The other accounts ({names}) each have their own endpoint and token: open this page in that account.", { names: others.map((a) => a.name).join(", ") })}
          </p>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Claude Code</h2>
        <p className="text-sm">
          {rich(t("Add it for the current user (or drop the JSON below into a project's <code>.mcp.json</code>):"), { code: (s) => <code className="code">{s}</code> })}
        </p>
        <pre className="pre">{claudeCli}</pre>
        <pre className="pre">{mcpJson}</pre>
        <p className="text-sm">
          {rich(
            t(
              'Then, after finishing a ticket, tell the agent something like <em>"Report 1.5h for PROJ-337 on job 2026-0815 in Zeff."</em> — or add that rule to your <code>CLAUDE.md</code> so it happens automatically.',
            ),
            { em: (s) => <em>{s}</em>, code: (s) => <code className="code">{s}</code> },
          )}
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Claude Desktop, Cursor & other clients")}</h2>
        <p className="text-sm">
          {rich(
            t(
              "Clients that support remote (HTTP) servers can use the JSON above. Clients that only speak stdio can bridge with <code>mcp-remote</code>:",
            ),
            { code: (s) => <code className="code">{s}</code> },
          )}
        </p>
        <pre className="pre">{stdioJson}</pre>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Tools")}</h2>
        <table className="table">
          <tbody>
            {tools().map(([name, desc]) => (
              <tr key={name}>
                <td className="font-mono whitespace-nowrap">{name}</td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Smoke test")}</h2>
        <pre className="pre">{curl}</pre>
      </section>
    </div>
  );
}
