import { isInstalled } from "@/plugins/state";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { run, fail, ok } from "./kit";

/** Registers search_knowledge, source_health, zeff_actions, search_context. */
export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool(
    "search_knowledge",
    {
      title: "Search the project knowledge (Confluence)",
      description:
        "The project's documentation (Confluence), compiled into a knowledge base: pages (title, space, link, the passage found, a summary) " +
        "and entities (systems, components, people, terms) with their relations. Search it before guessing how something works, " +
        "who is responsible or which environment does what. German and English words both find it.",
      inputSchema: z.object({
        query: z.string().describe("What to look for — words, a ticket key, a system name."),
        limit: z.number().int().min(1).max(15).optional().describe("Pages, default 6."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("knowledge")) return fail("Knowledge is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { knowledgeSearch } = await import("@/plugins/knowledge/client");
        const found = await knowledgeSearch(args.query, args.limit ?? 6);
        // Only what this caller may read (lib/boundaries): a personal space's pages not for an agent without personal data.
        const { mayRead, spaceLabels } = await import("@/lib/boundaries");
        const label = await spaceLabels();
        const r = { ...found, pages: found.pages.filter((p) => mayRead(label(p.space))) };
        if (!r.pages.length && !r.entities.length) return ok(`Nothing in the knowledge base for "${args.query}".`);
        const plain = (t: string) => t.replace(/[⟦⟧]/g, "").replace(/\s+/g, " ").trim();
        const pages = r.pages.map((p) => `- ${p.title} (${p.space})${p.url ? ` ${p.url}` : ""}${p.summary ? `\n  summary: ${plain(p.summary)}` : ""}\n  found: ${plain(p.snippet)}`);
        const entities = r.entities.map((e) => `- ${e.name} (${e.type}): ${e.summary}${e.related.length ? `\n  ${e.related.map((x) => (x.dir === "out" ? `→ ${x.rel} ${x.name}` : `← ${x.name} ${x.rel}`)).join("; ")}` : ""}`);
        return ok([pages.length ? `Pages:\n${pages.join("\n")}` : "", entities.length ? `Entities:\n${entities.join("\n")}` : ""].filter(Boolean).join("\n\n"));
      }),
  );

  server.registerTool(
    "source_health",
    {
      title: "Which of Zeff's sources are stale — before you rely on their data",
      description:
        "How each of Zeff's sources (sync steps: mail, Teams, WhatsApp, Signal, Jira, GitLab, Google Keep, the calendars, news …) holds up, judged from its data: " +
        "ok, failing (its runs keep failing), drift (the app changed, its driver may break), stale (no run though one was due) or silent " +
        "(its runs say ok but nothing new came for clearly longer than usual — a site that changed). With when its newest item came. " +
        "Check it before you draw conclusions from a source's data (\"nobody wrote\", \"no new tickets\"): a silent or stale source may just not have brought them.",
      inputSchema: z.object({
        source: z.string().optional().describe("One step's key or name (e.g. whatsapp, Teams); all when left out."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const { sourceHealth, sourceHealthText } = await import("@/lib/sync/source-health");
        const all = await sourceHealth();
        const want = args.source?.trim().toLowerCase();
        const list = want ? all.filter((h) => h.key.toLowerCase() === want || h.label.toLowerCase() === want) : all;
        if (want && !list.length) return fail(`No source "${args.source}". There are: ${all.map((h) => h.key).join(", ")}.`);
        return ok(sourceHealthText(list));
      }),
  );

  server.registerTool(
    "zeff_actions",
    {
      title: "What Zeff can be told to do — and what is set now",
      description:
        "The things plugins let Zeff do on a click (change the instructions of an AI step such as the branch naming, add a Kanban card …): each with its method, its fields, and — for the text you pass — what exists NOW " +
        "(the current instructions, the boards, what the knowledge base says). Read it before you write an instruction, a rule or a card, so what you write adjusts what is there instead of contradicting or doubling it.",
      inputSchema: z.object({
        query: z.string().optional().describe("What it is about, in words — a rule, a topic, a ticket key. The current state for it is read."),
        ticket: z.string().optional().describe("The ticket it is about, e.g. PROJ-306."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const { offeredMethods, offerContext } = await import("@/plugins/actions/server");
        const methods = Object.entries(offeredMethods());
        if (!methods.length) return ok("Nothing is offered.");
        const known = await offerContext({ ticket: args.ticket ?? "", text: args.query ?? "" });
        return ok(
          [
            ...methods.map(([name, m]) => `- ${name} — ${m.offer.label}\n  fields: ${Object.entries(m.offer.fields).map(([k, d]) => `${k} (${d})`).join("; ")}`),
            known.length ? `\nWhat exists now:\n${known.join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
  );

  server.registerTool(
    "search_context",
    {
      title: "Search everything Zeff keeps",
      description:
        "Missing context? Look through everything Zeff has: the knowledge base (Confluence, notes), mails, Teams messages, GitLab comments and merge requests, Jira tickets and their comments, the user's context notes and facts, todos, and what Zeff learned about people (roles, facts, bank details, addresses, phone; hits [person:<id>]). " +
        "Hits come with a reference ([mail:…], [teams:…], [jira-comment:…], T-12 …) and the passage found. Use it before guessing who decided what, what a question was about or how something works — " +
        "and before asking the user. German and English words both work; 2–5 specific words find more than a sentence.",
      inputSchema: z.object({
        query: z.string().min(2).describe("What to look for — words that stand in the texts: names, systems, ticket keys."),
        where: z.array(z.enum(["knowledge", "mails", "teams", "gitlab", "jira", "notes", "facts", "todos", "documents", "pages", "people"])).optional().describe("Only look in these sources (default: all)."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const { retrieve } = await import("@/lib/rag");
        const r = await retrieve([{ query: args.query, where: args.where }], { perSource: 4, maxChars: 9000 });
        return ok(r.hits.length ? r.text : `Nothing found for "${args.query}"${args.where?.length ? ` in ${args.where.join(", ")}` : ""} — try other words, or ask the user.`);
      }),
  );
}

/** Registers add_knowledge. */
export function registerAddKnowledgeTool(server: McpServer): void {
  server.registerTool(
    "add_knowledge",
    {
      title: "Add to the knowledge base",
      description:
        "Keep something in the user's knowledge base (their own knowledge, beside Confluence and what Zeff syncs): a fact, a note, how something works — or a link, whose page is read. " +
        "It's compiled into the knowledge graph right after and found by search_knowledge and the Chat. Use it when the user asks you to remember or note something, " +
        "or for a durable fact the user told you. Never for secrets (passwords, tokens, keys) and never for guesses.",
      inputSchema: z.object({
        text: z.string().min(1).describe("What to keep, in plain words (German or English) — or just a URL to read that page."),
        title: z.string().optional().describe("A short title; without one, the first line."),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("knowledge")) return fail("Knowledge is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { knowledgeAddOwn } = await import("@/plugins/knowledge/client");
        const r = await knowledgeAddOwn({ text: args.text, title: args.title });
        return ok(`Kept in the knowledge base as "${r.entry?.title ?? args.title ?? args.text.slice(0, 60)}" (${r.id}) — it's being compiled.`);
      }),
  );
}
