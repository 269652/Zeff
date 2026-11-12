// An exercise for a lesson: a widget of any kind. `spec` is an exercise set for Zeff's exercise kit (choice, number, text, formula, cloze, order,
// match, categorize, hotspot, slider, table, plot, code, scenario, cards); `html` is a widget of your own (a simulation, a 3D model, an
// experiment) with `libs`. It is checked first (the kit says every mistake); a mistake is thrown with each of them so the author can fix it.
// inputs: { step: id or title, title, spec?: object or JSON text, html?, libs?: ["katex", "chart" …] }
const STEPS = "@learn-ext.i3";
const EXERCISES = "@learn-ext.i10";
const steps = await zeff.database(STEPS);
const want = String(inputs.step).trim().replace(/^#/, "").toLowerCase();
const at = steps.rows.findIndex((r, i) => String(steps.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no step "${inputs.step}".`);
const spec = typeof inputs.spec === "string" && inputs.spec.trim() ? JSON.parse(inputs.spec) : inputs.spec;
const chk = await zeff.api("workspace.widgets.check", { spec, html: inputs.html, libs: inputs.libs });
if (!chk.ok) throw new Error(`The exercise wasn't made - fix these and send it again:\n- ${chk.problems.join("\n- ")}`);
const title = String(inputs.title || (spec && spec.title) || "Exercise").slice(0, 200);
const row = await zeff.addRow(EXERCISES, {
  Exercise: title,
  Step: String(steps.rows[at][0]),
  Html: spec ? "" : chk.html,
  Spec: spec ? JSON.stringify(spec) : "",
  Libs: chk.libs.join(","),
  Best: 0,
  XP: 0,
});
return { id: row.id, title };
