import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { detailText } from "./detail";
import { projectOf, resolveEntity } from "./resolve";
import { ENTITY_KINDS } from "./store";
import { entityGet, entityLine, entitySearch } from "./tools";

type Helpers = {
  run: (fn: () => unknown) => Promise<never>;
  ok: (text: string) => never;
  fail: (text: string) => never;
};

/**
 * The Entities plugin's MCP tools — entity_search and entity_get — registered where Zeff's other tools are (the MCP server, the
 * Workspace chat). While the plugin isn't installed they say so instead of failing oddly.
 */
export function registerEntityTools(server: McpServer, h: Helpers): void {
  const off = () => (isInstalled("entities") ? null : h.fail("Organisations, projects & places is not installed in Zeff (Menu → Plugins) — this tool isn't available."));

  server.registerTool(
    "entity_search",
    {
      title: "Find organisations, projects, places",
      description:
        "Find the organisations (org:<id>), projects (project:<id>) and places (place:<id>) Zeff knows — by a name or another name, a mail address or domain (the organisation behind it), a Jira ticket key or job number (its project), an address. " +
        "Also lists the people an address or name resolves to (person:<id>). Read one with entity_get for its links, people, tickets, mails, money, hours.",
      inputSchema: z.object({
        query: z.string().min(1).describe("A name, an address, a domain (acme.de), a mail address, a ticket key (PROJ-12), a job number, a street."),
        kind: z.enum(ENTITY_KINDS).optional().describe("Only this kind: org, project or place."),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, kind, limit }) =>
      h.run(async () => {
        const gone = off();
        if (gone) return gone;
        const hits = entitySearch(query, { kind, limit });
        const people = kind ? [] : resolveEntity(query).filter((m) => m.kind === "person");
        if (!hits.length && !people.length) return h.ok(`Nothing found for “${query}”.`);
        const lines = [...hits.map((x) => `- ${entityLine(x)}`), ...people.map((p) => `- ${p.name} (person, ${p.ref}) — by ${p.via}`)];
        return h.ok(`${lines.length} found for “${query}”:\n${lines.join("\n")}`);
      }),
  );

  server.registerTool(
    "entity_get",
    {
      title: "Read an organisation, project or place",
      description:
        "One organisation, project or place by its ref (org:<id>, project:<id>, place:<id>) with everything linked to it: other names, domains, address, job number, Jira keys and boards, repos, Workspace databases, the people working or living there, and what Zeff gathered (projects, tickets, latest mails, money paid and received, booked hours, appointments). " +
        "Also takes any other ref (ticket:PROJ-12, entry:<id>, job:<number>, todo:<id>, repo:<id>, mr:<group/project!iid>, page:<id>) and reads the project it belongs to.",
      inputSchema: z.object({ ref: z.string().min(3).describe("org:<id>, project:<id>, place:<id> — or a ticket, entry, job, todo, repo, MR or page ref to read its project.") }),
      annotations: { readOnlyHint: true },
    },
    async ({ ref }) =>
      h.run(async () => {
        const gone = off();
        if (gone) return gone;
        const own = /^(org|project|place):\d+$/.test(ref.trim());
        const target = own ? ref.trim() : projectOf(ref);
        if (!target) return h.fail(own ? `No entity ${ref}.` : `No project known for ${ref}.`);
        const d = entityGet(target);
        if (!d) return h.fail(`No entity ${target}.`);
        const links = d.links.filter((l) => l.rel !== "alias" && l.rel !== "domain").map((l) => `- ${l.rel}: ${l.label ? `${l.label} (${l.target})` : l.target}${l.source === "manual" ? "" : ` [${l.source}]`}`);
        const head = [
          `${entityLine(d)}${own ? "" : ` — the project of ${ref}`}`,
          d.note ? `Note: ${d.note}` : "",
          links.length ? `Links:\n${links.join("\n")}` : "",
          d.people.length ? `People:\n${d.people.map((p) => `- ${p.name} (${p.ref}, ${p.rel})`).join("\n")}` : "",
        ].filter(Boolean);
        return h.ok([...head, detailText({ note: "", sections: d.sections.filter((s) => s.title !== t("People")) })].filter(Boolean).join("\n\n"));
      }),
  );
}
