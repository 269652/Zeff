# Workspace — pages and databases

The Workspace (`workspace`, **on by default**; Menu → Plugins) is Zeff's Notion-style notebook: pages in a tree, a block
editor, and databases whose rows are pages — wired into everything else Zeff knows (people, todos, tickets, mails,
chats, the AI, agents over the MCP). Open it at `/workspace`.

It is documented in full, for users and developers, in **[docs/extensions/workspace.md](extensions/workspace.md)**:
pages and the tree, databases and their views, templates, pipelines and sources, automations, agents, jobs and rules,
flows and lifecycles, forms, metrics and the assistant — with its tables, AI tasks, MCP tools and extension points.

At a glance:

- **Pages**: a tree with favourites and trash, a block editor (`/` for blocks, `@` to mention people, todos, tickets and
  pages, Markdown shortcuts), autosave with a restorable history, backlinks, Markdown and CSV import/export, templates.
- **Databases**: typed properties (incl. person, Zeff todo, Jira ticket, relation, rollup, formula, AI), and the views
  table, board, list, gallery, calendar, **timeline**, chart, todo list and app views — each with its own filter, sorts
  and grouping.
- **Collections**: mails, chats, Keep notes, documents, people and more are kept as Workspace databases, filled by
  pipelines from their sources.

Related: [Studio](extensions/studio.md) (flows, lifecycles, screens), [Agenda](extensions/agenda.md),
[Google Keep Sync](extensions/keep.md), [Lookups](extensions/lookups.md).
