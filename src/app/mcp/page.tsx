import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { headers } from "next/headers";
import { DEFAULT_ACCOUNT, accountsInstalled, listAccounts } from "@/db/accounts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("MCP setup") };
}

const tools = (): [string, string][] => [
  ["report_time", t("Book hours on a job (jobNumber, hours, description, date?, ticket?, reportedBy?).")],
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
  const url = `${proto}://${host}/api/mcp`;
  // Each account its own endpoint; /api/mcp is the first account's, never the one switched to.
  const accounts = accountsInstalled() ? listAccounts() : [];
  const tokenSet = Boolean(process.env.ZEFF_MCP_TOKEN);
  const headerFlag = tokenSet ? ` --header "Authorization: Bearer <ZEFF_MCP_TOKEN>"` : "";
  const headersJson = tokenSet
    ? `,\n      "headers": { "Authorization": "Bearer <ZEFF_MCP_TOKEN>" }`
    : "";

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
      "args": ["-y", "mcp-remote", "${url}"${tokenSet ? `, "--header", "Authorization: Bearer <ZEFF_MCP_TOKEN>"` : ""}]
    }
  }
}`;
  const curl = `curl -s ${url} -H "content-type: application/json" -H "accept: application/json, text/event-stream"${tokenSet ? ' -H "authorization: Bearer <ZEFF_MCP_TOKEN>"' : ""} \
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
        {accounts.length > 1 && (
          <>
            <p className="text-sm">{t("One endpoint per account — an agent stays in its account, whichever one you switch to in Zeff:")}</p>
            <table className="table">
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{a.name}</td>
                    <td className="font-mono">{a.id === DEFAULT_ACCOUNT ? url : `${url}/${a.id}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="text-sm text-zinc-500">
          {tokenSet ? (
            <>
              {rich(t("Protected: requests must send <code>{header}</code>.", { header: "Authorization: Bearer <ZEFF_MCP_TOKEN>" }), { code: (s) => <code className="code">{s}</code> })}
            </>
          ) : (
            <>
              {rich(
                t("Currently unprotected (fine on localhost). Set <code>ZEFF_MCP_TOKEN</code> in <code>.env.local</code> to require a bearer token."),
                { code: (s) => <code className="code">{s}</code> },
              )}
            </>
          )}
        </p>
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
