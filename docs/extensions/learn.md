# Learn


> A learning platform **built with Zeff itself**: the AI researches a topic on the web and plans it as a skill tree; every step is a lesson
> with the AI as your teacher, who leaves cards and builds exercises; cards come back when you are about to forget them. **Category:** app ·
> **On by default:** no · **Beta:** yes (planning and lessons use your AI account) · **Needs:** the [Notebook](notebook.md) plugin (it runs
> Learn's server functions), an AI backend ([AI backends](ai-backends.md)); it works with [Todos](todos.md) (a todo per lesson) and
> [Calendar](calendar.md) (study times)

## For users

### Getting started

1. Open **Menu → Plugins** and turn on **Learn**.
2. Open **Learn** from the menu (*Apps*, the address is `/learn`). The first time, the page lists what will be set up and does it on one
   click: the Notebook plugin installed and *running code* switched on, the plugin “Learn (external)” switched on, its package installed
   with the permissions its flows and functions ask for. If you used the old Learn, **your courses, steps, cards and conversations are
   brought over** (the old databases stay as they are).
3. Learn opens as the **Learn** view of the *Courses* database in the Workspace.

### Using it

The **Learn page** (the app's top page) is an overview of every course: steps mastered, cards due and how many you know well, the streak,
XP today and this week, exercises done, XP per day, your cards by stack and one line per course. Each of these is a block of its own,
right in the page (no database around it), laid out in rows: `learn.header` (the heading and ↻, which reads every figure again),
`learn.stat` — one figure as a tile, which one is its parameter `metric` (`steps`, `due`, `known`, `streak`, `xp-today`, `xp-week`,
`exercises`, `level`) — `learn.xp-days` (the heatmap, `weeks` back), `learn.stacks` and `learn.course-lines`. So each can be picked,
moved, removed, set under ⚙ or changed on its own when the page is edited. They all read the flow `learn.dashboard`, which runs once for
all of them. `learn.overview` is still there — all of them in one block, as earlier Learn pages have it.
Its 🕘 *History* → *Whole app* keeps save points of the whole app (see [Workspace](workspace.md#versions-of-everything-you-build)).

The view has four tabs:

- **Home** — type a topic and press **Research and plan** (a web search finds curricula and textbooks, the AI plans the course on them and
  keeps the sources) or **Plan without research**. Each course shows its level, streak and today's experience against your daily goal
  (a setting of the app, in the form under the cards).
- **Skill tree** — the steps. **Master** ticks a step by hand (its experience is given once); **Open lesson** goes to the lesson. A step
  opens once everything it requires is mastered.
- **Review** — one card at a time: the question, *Show the answer* right under it, then *Again / Hard / Good / Easy*. Cards live in **four
  stacks** by how well you know them — stack 1 every day, 2 every 3 days, 3 every week, 4 every 3 weeks: *Good* moves a card up one, *Easy*
  two, *Hard* keeps it, *Again* puts it back in stack 1 and shows it again at the end of the round. On the card: 💡 *Hint* (a nudge that
  does not give the answer away), 📖 *Explain* and 🧪 *Exercise* (a small exercise for the card, kept with it) — answered by the plugin's
  card helper below the card. A card keeps an exercise of its own (the teacher makes one with each card): folded under it, no AI needed.
  The *Cards* database has the stacks as a tab of their own.
- **Lesson** — a live chat with your teacher (a Claude session in Zeff, the plugin's own *kind of chat*; it calls Learn's functions through Zeff's tools). The conversation is kept in the **Conversations** database: what you change or delete there is what the teacher goes on with. The teacher answers, may leave up to eight cards, build exercises — an **exercise set** for Zeff's exercise kit (choice, number,
  text, formula, cloze, order, match, categorize, hotspot, slider, table, plot, code, scenario, cards) or a **widget of its own** (a
  simulation, a 3D model) — shown right there, and master the step when you have shown that you reached its goal. **Make it a todo** puts “Learn: …” on your todo list;
  **Study time** puts an appointment into your Zeff calendar.

### It is yours to change

Learn is not code in Zeff: everything is a Workspace page you can open.

| What | Where |
|---|---|
| Courses, Steps, Cards, Conversations, Exercises, Activity | databases under the **Learn** page — add fields, views, filters like in any database |
| The app (its four tabs) | the **Learn** view of Courses — a [view template](workspace.md) you can edit |
| What the buttons do | flows (*Master a step*, *Answer a card*, *Talk to the teacher* …) on the same page — open them in the Studio |
| Spaced repetition, levels, streak, the teacher, planning | server functions of the plugin “Learn (external)” (Node.js files in the plugins folder) |
| Updates | *Workspace settings → Packages* — a newer version updates in place and keeps what you changed |

## Technical reference

The plugin `learn` (src/plugins/learn) is only the menu entry, the setup page and the import of the old data
([setup.ts](../../src/plugins/learn/setup.ts), [legacy-import.ts](../../src/plugins/learn/legacy-import.ts)). Everything else is the external plugin
in [src/plugins/learn/bundled](../../src/plugins/learn/bundled) — its manifest, server functions and package — copied into the plugins folder
by the setup. It is the benchmark of [Zeff in Zeff](../zeff-in-zeff.md); the [README](../../src/plugins/learn/bundled/README.md) of the
bundled plugin says what it uses. Tests: `tests/learn-external.test.ts`.

**What changed from the Learn Zeff had before** (it was a built-in part of Zeff; this one is built from Zeff's own building blocks):

- **Spaces** are a field of the course (*Space*): a named group of courses, filtered on Home — not a page of its own with its own databases. Progress, cards and conversations are per course as before.
- The **teacher** is a live Claude session in Zeff's chat kind for plugins; it calls Learn's functions through Zeff's tools instead of five special tools. The **exercises** are the same kit (exercise sets and widgets of its own), kept in the Exercises database with every try.
- The **skill map** is Zeff's general graph element, fed by the function *skillmap*; the **red thread** goes through the skills walked and then the plan ahead.
- The **research** is a function (OpenAlex, Semantic Scholar, arXiv, and a web search by a flow) and the plan is checked and repaired by the same rules as before; the long AI answer is asked with a schema and up to 9 minutes, so a very large plan may need *Update planning* in a second pass.
- The **hourly upkeep** is a schedule of the plugin (*Zeff's building block `contributes.schedules`*).

Not brought over from the old Learn: the page *Learning space* as a template (use a new Space instead) and the snapshots of old exercise tries (the answers of tries stay in the old databases).
