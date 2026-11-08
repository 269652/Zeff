/**
 * What a new flow starts from in the Studio: empty, or one of a few that show what flows are for — a web API read, a web page picked
 * apart into a lookup source, the AI filling a row, an approval before something is done, a morning digest. Client-safe.
 */

export type Starter = { id: string; label: string; what: string; /** An automation (it runs by itself) — offered under + Automation; run once at once when made. */ automation?: boolean; runNow?: boolean; def: (name: string) => Record<string, unknown> };

export const STARTERS: Starter[] = [
  {
    id: "checkin",
    label: "Ask me regularly",
    what: "Every hour from 8 to 22: a question to you with a scale and a note — the answer kept with its time in a database in the journal (made when it isn't there), which the journal's reviews read. Built from blocks: change the question, the answers, the schedule, where it goes.",
    automation: true,
    runNow: true,
    def: (name) => ({
      name,
      title: "Check-in: how are you?",
      triggers: [{ kind: "schedule", everyMinutes: 60, from: "08:00", to: "22:00" }],
      permissions: { create: true },
      nodes: [
        { id: "ask", kind: "ask", label: "Ask", title: "How are you, from 1 to 10?", fields: [{ name: "value", kind: "scale", min: 1, max: 10, required: true }, { name: "note", kind: "text", label: "Note" }], expiresMinutes: 55 },
        { id: "db", kind: "action", label: "The database", action: "db.ensure", input: { name: "Check-ins", parent: "Journal", orTop: true, fields: { When: "datetime", Answer: "number", Note: "text" } } },
        { id: "keep", kind: "action", label: "Keep the answer", action: "db.insert", input: { database: "{{ steps.db.id }}", title: "{{ steps.ask.value }}", values: { When: "{{ env.local }}", Answer: "{{ steps.ask.value }}", Note: "{{ steps.ask.note }}" } } },
      ],
    }),
  },
  {
    id: "evening",
    label: "Evening question into the journal",
    what: "Every evening at 21:00: what were you grateful for today? — the answer as the day's journal entry.",
    automation: true,
    def: (name) => ({
      name,
      title: "Evening: grateful for",
      triggers: [{ kind: "schedule", at: "21:00" }],
      permissions: { create: true },
      nodes: [
        { id: "ask", kind: "ask", title: "What were you grateful for today?", fields: [{ name: "text", kind: "text", required: true }], expiresMinutes: 180 },
        { id: "db", kind: "action", action: "db.ensure", input: { name: "Gratitude", parent: "Journal", orTop: true, fields: { Date: "date", Text: "text" } } },
        { id: "keep", kind: "action", action: "db.insert", input: { database: "{{ steps.db.id }}", title: "{{ steps.ask.text | truncate(60) }}", values: { Date: "{{ env.today }}", Text: "{{ steps.ask.text }}" } } },
      ],
    }),
  },
  { id: "blank", label: "Empty", what: "Nothing in it yet.", def: (name) => ({ name, nodes: [] }) },
  {
    id: "api",
    label: "Read a web API",
    what: "Calls an API with a key from your secrets and gives back what you pick out of its answer.",
    def: (name) => ({
      name,
      inputs: [{ name: "query", type: "text", required: true }],
      permissions: { web: ["api.example.com"] },
      nodes: [
        { id: "call", kind: "action", action: "http.request", input: { url: "https://api.example.com/search", query: { q: "{{ input.query }}" }, headers: { authorization: "Bearer {{ secrets.EXAMPLE_KEY }}" } } },
        { id: "pick", kind: "script", code: "// steps.call.json is the API's answer\nreturn (steps.call.json?.results ?? []).slice(0, 10).map((r) => ({ id: r.id, title: r.title }));" },
      ],
      output: "{{ steps.pick }}",
    }),
  },
  {
    id: "recipe",
    label: "Web page as a lookup source",
    what: "Searches a site, picks the hits out of its HTML with CSS selectors and the details with the AI — a <lookup> in a view can use it.",
    def: (name) => ({
      name,
      lookup: { label: "My source", what: "finds things on example.com", fields: { title: "its title", year: "its year", summary: "what it is about" } },
      permissions: { web: ["www.example.com"], ai: true },
      nodes: [
        {
          id: "mode",
          kind: "switch",
          on: "input.mode",
          cases: [
            {
              value: "search",
              nodes: [
                { id: "page", kind: "action", action: "web.html", input: { url: "https://www.example.com/search?q={{ input.query | urlencode }}" } },
                { id: "hits", kind: "action", action: "extract.css", input: { html: "{{ steps.page.html }}", items: ".result", fields: { id: "a@href", title: "a", subtitle: ".meta" } } },
                { id: "r1", kind: "return", value: "{{ steps.hits.items | slice(0, 8) }}" },
              ],
            },
            {
              value: "details",
              nodes: [
                { id: "read", kind: "action", action: "web.read", input: { url: "https://www.example.com{{ input.id }}" } },
                { id: "fields", kind: "action", action: "ai.extract", input: { text: "{{ steps.read.text }}", fields: { title: "the title", year: "the year (a number)", summary: "two sentences about it" } } },
                { id: "r2", kind: "return", value: "{{ steps.fields }}" },
              ],
            },
          ],
          default: [],
        },
      ],
    }),
  },
  {
    id: "enrich",
    label: "AI fills a row",
    what: "A button in a row: the AI reads the row's page and fills its fields.",
    def: (name) => ({
      name,
      permissions: { ai: true },
      nodes: [
        { id: "row", kind: "action", action: "db.get", input: { row: "{{ row.id }}" } },
        { id: "fields", kind: "action", action: "ai.extract", input: { text: "{{ steps.row.title }}\n{{ steps.row.text }}", fields: { Summary: "one sentence", Category: "one word" } } },
        { id: "write", kind: "action", action: "db.update", input: { row: "{{ row.id }}", values: "{{ steps.fields }}" } },
      ],
    }),
  },
  {
    id: "approval",
    automation: true,
    label: "Ask before doing it",
    what: "Prepares something, waits for your yes, then does it — a todo and the run console ask.",
    def: (name) => ({
      name,
      inputs: [{ name: "what", type: "text", required: true }],
      nodes: [
        { id: "ask", kind: "approve", title: "Do it: {{ input.what }}?", options: ["yes", "no"] },
        { id: "go", kind: "if", when: "steps.ask.choice == 'yes'", then: [{ id: "note", kind: "action", action: "notify", input: { text: "Done: {{ input.what }}" } }], else: [] },
      ],
    }),
  },
  {
    id: "digest",
    automation: true,
    label: "Morning digest",
    what: "Every weekday at 7:30: the open rows of a database, summed up by the AI into a todo.",
    def: (name) => ({
      name,
      triggers: [{ kind: "schedule", at: "07:30", days: [1, 2, 3, 4, 5] }],
      permissions: { ai: true },
      nodes: [
        { id: "open", kind: "action", action: "db.query", input: { database: "Tasks", where: { Done: false }, limit: 50 } },
        { id: "sum", kind: "action", action: "ai.ask", input: { prompt: "Fasse in drei Sätzen zusammen, was heute ansteht.", context: "{{ steps.open.rows | json }}" } },
        { id: "todo", kind: "action", action: "notify", input: { text: "{{ steps.sum.answer }}", todo: true } },
      ],
    }),
  },
];
