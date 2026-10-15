# Workspace — pages and databases

The Workspace plugin (`workspace`, off until you install it under Menu → Plugins) is a Notion-style notebook inside Zeff:
pages in a tree, a block editor, databases with several views — and it is wired into everything else Zeff knows.

Open it at `/workspace`.

## Pages

- **Tree** in the left column: nest pages, drag to reorder or move (drop on a page to put it inside, on its upper/lower edge to put it before/after), favorites, trash, search (words by their beginnings, titles first).
- **Editor** (Tiptap / ProseMirror): paragraphs, headings 1–3, bulleted / numbered / to-do lists (nested), toggles, quotes, callouts, dividers, code blocks with highlighting, tables, pictures, links, highlights.
  - Type `/` for the block menu (also: sub-page, a database in the page, a linked view of an existing database, AI), `@` to mention.
  - Markdown shortcuts work as you type (`#`, `-`, `1.`, `[]`, `>`, `` ``` ``, `**bold**`); pasted Markdown becomes blocks; pictures can be pasted or dropped.
  - Drag handle (⠿) moves a block, `+` adds one below.
- **Autosave** every second of quiet; a version of the previous state is kept every ten minutes you edit (**History**, restorable). If a page was changed somewhere else meanwhile (another tab, an agent), you are asked: load theirs, or keep yours.
- **Backlinks** ("Linked from"), sub-pages, breadcrumbs, cover (gradient or picture), icon, full width / small text, lock.
- **Trash**: moved pages come back with what is below them; "Delete for good" removes them and their history.
- **Export** a page as Markdown; **import** Markdown or a CSV (as a database) from the start page.
- **Templates**: meeting notes, 1:1, project brief, weekly review, wiki home — and ready-made databases (tasks, decision log, reading list, projects with tasks).
- **Today** (📅 in the sidebar): today's page under "Daily notes", made at the first use, with your todos that are due as links.

## Databases

A database is a page whose rows are pages (each row has a body of its own). Rows are opened like any page; their properties sit above the text.

- **Properties**: text, number, select, multi-select, status (to do / in progress / done groups), date (range, time), checkbox, URL, email, phone, **person** (your People profiles), **Zeff todo**, **Jira ticket**, **relation** (to another database, optionally shown on the other side), **rollup** (through a relation: count, sum, average, median, min, max, earliest/latest, percent done …), **formula**, created / last edited time, and **AI** (fills the cell from the row).
- **Views**: table, board (drag cards between columns), list, gallery, calendar (drag to move; spans), each with its own filter (nested and/or groups), sorts, group-by and visible properties. A database can be shown inside any page (`/linked database`), with its own view.
- **Formulas**: `prop("Hours") * 80`, `if(prop("Done"), "✓", "…")`, `dateBetween(prop("Due"), today(), "days")`, `concat`, `round`, `formatDate`, … — parsed here, no `eval`. A formula can use rollups and other formulas; a circular one says so.
- **Row templates**: open a row → ⋯ → "Use as a template"; then `New ▾` offers it.
- **CSV export** of a view; **CSV import** guesses the column types.

## Where it is more than a Notion clone

- `@` mentions people (the People plugin), todos (with their live status), Jira tickets and other pages. A person's page lists the workspace pages that mention them.
- Everything is searchable together with the rest of Zeff: the command palette (Ctrl+K), the AI steps' retrieval (`pages` source) and the agents' `search_context`.
- **AI** (needs the LLM plugin): bubble menu on a selection (improve, fix spelling, shorter, longer, explain, translate), `/continue`, `/summarize`, `/action items`, `/ask AI`, **Make Zeff todos** from a page (you choose which), **Ask your workspace** on the start page, AI properties in databases.
- **Agents over the MCP** read and write it: `workspace_search`, `workspace_read_page`, `workspace_create_page`, `workspace_append`, `workspace_update_page`, `workspace_query_database`, `workspace_add_row`. A locked page is left alone.
- Your data stays in Zeff's own database; pictures go to `workspace-files/` next to it.

## Data

Tables (made when first needed): `ws_pages` (pages, databases, rows; the document as ProseMirror JSON, the schema of a database as JSON), `ws_versions`, `ws_links` (mentions → backlinks), `ws_fts` (FTS5 index). Code: `src/plugins/workspace/` — `doc.ts` (document ↔ text/Markdown, cleaning), `formula.ts`, `model.ts` (properties, filters, sorts, groups, rollups — pure), `store.ts`, `actions.ts` (server actions), `mcp.ts`, `templates.ts`, `ui/` (editor, views, sidebar). Tests: `tests/workspace-*.test.ts`.

## Not (yet) there

Real-time co-editing, comments on blocks, synced blocks, columns, public sharing, offline mode, embeds (video, Figma …), database timeline view, per-user permissions (Zeff is single-user).
