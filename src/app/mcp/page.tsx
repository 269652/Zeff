import type { Metadata } from "next";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "MCP setup" };

const TOOLS: [string, string][] = [
  ["report_time", "Book hours on a job (jobNumber, hours, description, date?, ticket?, reportedBy?)."],
  ["list_jobs", "List job numbers, optionally filtered by a search term."],
  ["create_job", "Create a new job number."],
  ["get_weekly_report", "Hours per job and weekday for a week, plus all its entries."],
  ["list_time_entries", "List entries with filters (job, date range, ticket, reporter)."],
  ["update_time_entry", "Correct an entry."],
  ["delete_time_entry", "Delete an entry booked by mistake."],
];

export default async function McpPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  const url = `${proto}://${host}/api/mcp`;
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
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Connect an agent</h1>
        <p className="text-sm text-zinc-500">
          Zeff exposes a Model Context Protocol server over Streamable HTTP. Any MCP client can
          book time on jobs with the <code className="code">report_time</code> tool.
        </p>
      </div>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Endpoint</h2>
        <pre className="pre">{url}</pre>
        <p className="text-sm text-zinc-500">
          {tokenSet ? (
            <>
              Protected: requests must send <code className="code">Authorization: Bearer &lt;ZEFF_MCP_TOKEN&gt;</code>.
            </>
          ) : (
            <>
              Currently unprotected (fine on localhost). Set <code className="code">ZEFF_MCP_TOKEN</code> in{" "}
              <code className="code">.env.local</code> to require a bearer token.
            </>
          )}
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Claude Code</h2>
        <p className="text-sm">Add it for the current user (or drop the JSON below into a project&apos;s <code className="code">.mcp.json</code>):</p>
        <pre className="pre">{claudeCli}</pre>
        <pre className="pre">{mcpJson}</pre>
        <p className="text-sm">
          Then, after finishing a ticket, tell the agent something like{" "}
          <em>&quot;Report 1.5h for PROJ-337 on job 2026-0815 in Zeff.&quot;</em> — or add that rule to your{" "}
          <code className="code">CLAUDE.md</code> so it happens automatically.
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Claude Desktop, Cursor &amp; other clients</h2>
        <p className="text-sm">Clients that support remote (HTTP) servers can use the JSON above. Clients that only speak stdio can bridge with <code className="code">mcp-remote</code>:</p>
        <pre className="pre">{stdioJson}</pre>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Tools</h2>
        <table className="table">
          <tbody>
            {TOOLS.map(([name, desc]) => (
              <tr key={name}>
                <td className="font-mono whitespace-nowrap">{name}</td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Smoke test</h2>
        <pre className="pre">{curl}</pre>
      </section>
    </div>
  );
}
