# Learn (external)

Zeff's **Learn** — a skill tree, spaced repetition, experience, levels, a streak — rebuilt as an **external plugin**, using only what an
external plugin can use. It is the benchmark of "Zeff in Zeff" ([plan](../../../docs/zeff-in-zeff.md), stage 5): whatever it could not
say became the next thing to build.

It does what the built-in Learn does, with one difference: the lesson's teacher is one call to the AI per message (`teach`), not a live
session with tools.

## What is in it

| Part | Where | What it uses |
|---|---|---|
| Courses, Steps, Cards, Activity | `learn.package.json` (databases with fields, relation Steps → Courses, sample rows) | packages |
| One app: Home, Skill tree, Review, Lesson | the **Learn** view of Courses (one template) | the view language: tabs and `<switch>`, `<data>` loaded by flows, events (`emit` / `<on>`), `<def>` functions, `<markdown>`, `<setting>` / `<settings/>`, a widget block for exercises |
| Master a step · Answer a card · Plan a course · Research and plan · Talk to the teacher · Study times · Lesson todo · loading flows | flows in the package | flow actions of this plugin, `web.search`, `db.query` |
| Spaced repetition (SM-2), levels, streak, badges, which steps are open | `fn/review.js`, `fn/game.js`, `fn/unlocked.js` | server functions (Node.js), the same rules as the built-in Learn |
| Give experience, master, answer, plan with the AI, **the teacher**, **study times**, **lesson todos** | `fn/award.js`, `master.js`, `grade.js`, `plan.js`, `teach.js`, `schedule.js`, `lessontodo.js` | functions that write into the package's databases (`@learn-ext.i3` …), call each other (`zeff.call`), ask the AI (`zeff.ai`) and use Zeff's methods (`zeff.api("calendar.event.add")`, `zeff.api("todos.add")`) |
| Tests, migrations, requirements, versions | in `learn.package.json` | packages that live |

## Try it

1. This folder ships with Zeff; the setup on the **Learn** page copies it into the plugins folder and switches **Learn (external)** on. The Notebook
   plugin must be installed and *Let code blocks run* switched on (*Settings → Notebook*).
2. *Workspace settings → Packages → Learn → Install and allow what it asks* (its three flows get the permissions they request; the
   package's own tests run).
3. *Settings → Notebook → Functions of plugins → Allow what they need* (the functions may read and write the package's databases).
4. Open the **Learn** page: *Courses → Dashboard*, *Steps → Skill tree* (press **Master**), *Cards → Review*.

## What building it taught Zeff

- The databases a package makes have new ids wherever it is installed, so a function's `needs` and code name them by their place in the
  package: `write:database:@learn-ext.i4`, `zeff.updateRow("@learn-ext.i4", id, …)`.
- Code writing a choice field by the option's name (`Kind: "skill"`) is mapped to the option; a name that is no option is refused with the
  ones there are.
- A package can ask the person once to give its flows what they request (*Install and allow what it asks*), listed beforehand.
- Views reach plugin functions through flows (`run=`), which keeps one permission model: the flow's permissions and the function's grants.
