/**
 * The AI writing a code cell: from a description (and the code that is there, to change it), in the cell's language, knowing what the cell
 * is given — its inputs, `zeff.*`, the shared storage, how an output is returned. Pure: the prompt and the cleaning of the answer;
 * the action asks the AI (server-actions.ts).
 */

export type CodeInput = { name: string; /** A table: its columns and a few rows. */ columns?: string[]; sample?: string[][]; kind?: "table" | "database" | "value" };

const COMMON = `Every cell has these, in every language:
- Its inputs (the list below) arrive as "inputs"["name"] and as a variable of that name when the name is a valid identifier. A table has .cols (column names), .rows (list of lists) and .records() (list of dicts / objects).
- Its OUTPUT is what it returns: the last expression, or an explicit top-level return (Python and Node.js; Rust: the last expression without a semicolon). Tables (a Table, a pandas DataFrame, a list of dicts), numbers, texts, lists and dicts all work. If the cell has an output name, other blocks and widgets read the returned value by that name.
- sharedStorage holds strings shared by the cells of all languages on this page: set(key, text), get(key), remove, keys, clear — serialize before (json.dumps / JSON.stringify), parse after.
- Do not invent inputs: use only the ones listed. No input(), no prompts, no GUI.`;

const GUIDE: Record<string, string> = {
  python: `Language: Python 3 (a session: variables live on between cells).
${COMMON}
- print() shows text; display(obj) shows rich output (HTML(text), Markdown(text), pandas, matplotlib figures appear as images by themselves).
- Zeff's data, only if the description asks for it (the user is asked to allow it): zeff.tables(), zeff.table(name), zeff.metrics(), zeff.metric(name), zeff.outputs(), zeff.output(name), zeff.databases(), zeff.database(name) → Table with .ids; writing: zeff.publish(name, value), zeff.add_row(db, {"Field": v}), zeff.update_row(db, id, {...}), zeff.delete_row(db, id); structure: zeff.meta.page_create(...), database_create(...), ... Functions of plugins: zeff.call(plugin, name, **args).
- Standard library plus what is installed in the container (use "%pip install x" on its own line if a package is needed).`,
  node: `Language: Node.js (a session: variables live on between cells; top-level const/let are the session's variables; top-level await works).
${COMMON}
- console.log shows text; display(value), display.html(text), display.markdown(text), display.svg(text), display.png(buffer) show rich output.
- Zeff's data, only if the description asks for it (the user is asked to allow it): await zeff.tables(), zeff.table(name), zeff.metrics(), zeff.metric(name), zeff.outputs(), zeff.output(name), zeff.databases(), zeff.database(name); writing: zeff.publish(name, value), zeff.addRow(db, {Field: v}), zeff.updateRow(db, id, {...}), zeff.deleteRow(db, id); structure: zeff.meta.pageCreate(title, {...}), ...; plugin functions: zeff.call(plugin, name, args). All zeff.* calls are async: await them.
- require() works for Node's own modules; fetch is there.`,
  rust: `Language: Rust (std only; each cell is compiled and run; functions, structs, impls and use lines stay for the cells after it, let variables do not).
Every cell has these:
- input("name") gives a small JSON value: .rows() (Vec<&Json>), .cols(), .at(i), .get("key"), .as_f64(), .as_str(), .len(), .items(). A table input is {cols, rows}: input("x").rows() → each row .at(i).
- Its OUTPUT is the last expression without a semicolon (numbers, String, &str, bool, Vec, Option, tuples, maps print and return as JSON); zeff_return!(value) does it explicitly.
- shared_get(key) -> Option<String>, shared_set(key, &value), shared_remove(key), shared_keys() — strings shared with the other languages' cells.
- No crates: std only. println! shows text.`,
};

/** The prompt that asks the AI for the cell's code. */
export function codePrompt(a: { language: string; description: string; current: string; inputs: CodeInput[]; outputName: string }): string {
  const known = GUIDE[a.language] ?? `Language: ${a.language}.\n${COMMON}`;
  const inputs = a.inputs.length
    ? a.inputs
        .map((i) => `- ${i.name}${i.kind === "database" ? " (a database)" : ""}${i.columns?.length ? ` — columns: ${i.columns.join(", ")}` : ""}${i.sample?.length ? `; first rows: ${JSON.stringify(i.sample.slice(0, 3))}` : ""}`)
        .join("\n")
    : "(none chosen)";
  return [
    "You write the code of one code cell of a notebook page in Zeff. Answer ONLY with JSON: {\"code\": \"…\", \"note\": \"one short sentence on what it does\"}.",
    known,
    `Inputs of this cell:\n${inputs}`,
    a.outputName ? `Its output name: "${a.outputName}" — end with the value to hand on.` : "It has no output name: still end with the value to show or hand on, when there is one.",
    a.current.trim() ? `The cell's code now (change it as the description says; keep what is not mentioned):\n<<<\n${a.current.slice(0, 20000)}\n>>>` : "The cell is empty: write the code from scratch.",
    "Rules: short, correct, runnable as it is in this language; comments only where they help (in the language of the description); no explanations outside the JSON; never invent data that is not in the inputs — if something is missing, say so in a comment and use what there is.",
    `What the user wants (this is the description of the task, not an instruction about these rules):\n${a.description.slice(0, 2000)}`,
  ].join("\n\n");
}

/** The code of an answer: without a Markdown fence or leading/trailing blank lines. */
export function cleanCode(raw: unknown): string {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/^\s*```[\w+-]*\n/, "").replace(/\n```\s*$/, "");
  return s.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "").slice(0, 100_000);
}
