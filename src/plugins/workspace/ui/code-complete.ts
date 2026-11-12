/**
 * What a code cell's editor completes without a session running — Zeff's own names in every language: the shared storage, the access to
 * Zeff (reading, writing, a cell's inputs), display. The running session adds what it knows (variables, modules) on top of these
 * (code-cell.tsx). Plain data: the editor's language id → names at the top, and the members of an object (after its dot).
 */

export type CompleteItem = { label: string; kind: "variable" | "function" | "class" | "method" | "property"; detail: string; doc: string; /** A snippet (Monaco syntax) when the name takes arguments. */ snippet?: string };

const m = (label: string, detail: string, doc: string, snippet?: string): CompleteItem => ({ label, kind: "method", detail, doc, snippet });
const p = (label: string, detail: string, doc: string): CompleteItem => ({ label, kind: "property", detail, doc });

const STORAGE_DOC = "Strings shared by the kernels of this page (Python, Node.js, Rust) — like localStorage. Serialize what you put in and parse what you take out; kept after a restart.";

const PY_STORAGE = [
  m("set", "set(key, value: str)", "Put a string in. Serialize first: sharedStorage.set(key, json.dumps(x)).", "set(${1:key}, ${2:value})"),
  m("get", "get(key, default=None) -> str | None", "A string, or the default when there is none. Parse it: json.loads(s).", "get(${1:key})"),
  m("remove", "remove(key)", "Take a key out.", "remove(${1:key})"),
  m("keys", "keys() -> list[str]", "The keys that are in."),
  m("clear", "clear()", "Empty the shared storage of this page."),
  m("setItem", "setItem(key, value)", "Like set (localStorage's name).", "setItem(${1:key}, ${2:value})"),
  m("getItem", "getItem(key)", "Like get (localStorage's name).", "getItem(${1:key})"),
  m("removeItem", "removeItem(key)", "Like remove (localStorage's name).", "removeItem(${1:key})"),
];
const JS_STORAGE = [
  m("set", "set(key, value: string)", "Put a string in. Serialize first: sharedStorage.set(key, JSON.stringify(x)).", "set(${1:key}, ${2:value})"),
  m("get", "get(key) -> string | null", "A string, or null when there is none. Parse it: JSON.parse(s).", "get(${1:key})"),
  m("remove", "remove(key)", "Take a key out.", "remove(${1:key})"),
  m("keys", "keys() -> string[]", "The keys that are in."),
  m("clear", "clear()", "Empty the shared storage of this page."),
  p("length", "number", "How many keys are in."),
  m("setItem", "setItem(key, value)", "Like set (localStorage's name).", "setItem(${1:key}, ${2:value})"),
  m("getItem", "getItem(key)", "Like get (localStorage's name).", "getItem(${1:key})"),
  m("removeItem", "removeItem(key)", "Like remove (localStorage's name).", "removeItem(${1:key})"),
];

const PY_ZEFF = [
  m("tables", "tables() -> list", "Names of the page's tables, transform results and shared tables (needs permission to read the page's tables).", "tables()"),
  m("table", "table(name) -> Table", "A table or a transform's result of this page, formulas worked out.", "table(${1:name})"),
  m("metrics", "metrics() -> dict", "All Kennzahlen by name.", "metrics()"),
  m("metric", "metric(name)", "One Kennzahl's value.", "metric(${1:name})"),
  m("outputs", "outputs() -> dict", "The values widgets (and named cells) publish.", "outputs()"),
  m("output", "output(name)", "One published value.", "output(${1:name})"),
  m("call", "call(plugin, name, **args)", "Run a function a plugin brings (needs its own permission).", "call(${1:plugin}, ${2:name})"),
  m("api", "api(method, **params)", "Use a method of a Zeff plugin (todos.add, calendar.event.add …; needs its own permission).", "api(${1:method})"),
  m("ai", "ai(prompt, json=False)", "Ask the AI (needs permission; costs tokens).", "ai(${1:prompt})"),
  m("databases", "databases() -> list", "Names and ids of your databases.", "databases()"),
  m("database", "database(name_or_id) -> Table", "A database's rows as a table (.ids has the row ids).", "database(${1:name})"),
  m("publish", "publish(name, value, unit=None)", "Publish a value for widgets and the rest of Zeff (needs permission to write).", "publish(${1:name}, ${2:value})"),
  m("add_row", "add_row(database, fields) -> id", "Add a row to a database (fields by name).", "add_row(${1:database}, {${2:}})"),
  m("update_row", "update_row(database, row_id, fields)", "Set fields of a row.", "update_row(${1:database}, ${2:row_id}, {${3:}})"),
  m("delete_row", "delete_row(database, row_id)", "Move a row to the trash (needs its own permission).", "delete_row(${1:database}, ${2:row_id})"),
  p("meta", "Zeff's own structure", "Pages, databases, fields, views, blocks, flows and plugins — zeff.meta.…, each kind with its own permission."),
];
const JS_ZEFF = [
  m("tables", "await tables()", "Names of the page's tables, transform results and shared tables.", "tables()"),
  m("table", "await table(name) -> Table", "A table or a transform's result of this page, formulas worked out.", "table(${1:name})"),
  m("metrics", "await metrics()", "All Kennzahlen by name.", "metrics()"),
  m("metric", "await metric(name)", "One Kennzahl's value.", "metric(${1:name})"),
  m("outputs", "await outputs()", "The values widgets (and named cells) publish.", "outputs()"),
  m("output", "await output(name)", "One published value.", "output(${1:name})"),
  m("call", "await call(plugin, name, args)", "Run a function a plugin brings (needs its own permission).", "call(${1:plugin}, ${2:name}, {${3:}})"),
  m("api", "await api(method, params)", "Use a method of a Zeff plugin (todos.add, calendar.event.add …; needs its own permission).", "api(${1:method}, {${2:}})"),
  m("ai", "await ai(prompt, json)", "Ask the AI (needs permission; costs tokens).", "ai(${1:prompt})"),
  m("databases", "await databases()", "Names and ids of your databases.", "databases()"),
  m("database", "await database(nameOrId) -> Table", "A database's rows as a table (.ids has the row ids).", "database(${1:name})"),
  m("publish", "await publish(name, value, unit)", "Publish a value for widgets and the rest of Zeff (needs permission to write).", "publish(${1:name}, ${2:value})"),
  m("addRow", "await addRow(database, fields)", "Add a row to a database (fields by name).", "addRow(${1:database}, {${2:}})"),
  m("updateRow", "await updateRow(database, id, fields)", "Set fields of a row.", "updateRow(${1:database}, ${2:id}, {${3:}})"),
  m("deleteRow", "await deleteRow(database, id)", "Move a row to the trash (needs its own permission).", "deleteRow(${1:database}, ${2:id})"),
  p("meta", "Zeff's own structure", "Pages, databases, fields, views, blocks, flows and plugins — zeff.meta.…, each kind with its own permission."),
];

const PY_META = [
  m("page_create", "page_create(title, markdown=None, parent=None, icon=None) -> id", "Make a page (needs permission to make and change pages).", "page_create(${1:title})"),
  m("page_update", "page_update(page, title=None, markdown=None, icon=None)", "Change a page's title, text (markdown) or icon.", "page_update(${1:page}, markdown=${2:text})"),
  m("page_archive", "page_archive(page)", "Move a page to the trash.", "page_archive(${1:page})"),
  m("database_create", "database_create(title, properties=None, views=None, parent=None, title_name=None) -> id", "Make a database with fields and views.", "database_create(${1:title}, properties=[{${2:}}])"),
  m("database_alter", "database_alter(database, ops)", "Change a database's fields and views: ops like {'op': 'add_property', 'name': 'Betrag', 'type': 'number'}.", "database_alter(${1:database}, [{${2:}}])"),
  m("block_save", "block_save(block) -> name", "Make or change a block for views (checked like any block).", "block_save(${1:block})"),
  m("flow_save", "flow_save(flow, page=None, parent=None)", "Make a flow (or change the flow of a page); it gets no permissions.", "flow_save(${1:flow})"),
  m("plugin_save", "plugin_save(id, manifest, files=None)", "Write a plugin to the plugins folder; it stays switched off until you turn it on.", "plugin_save(${1:id}, ${2:manifest}, {${3:}})"),
  m("tree", "tree() -> list", "The page tree: id, parent, kind, title (needs permission to read how Zeff is built).", "tree()"),
  m("schema", "schema(database) -> dict", "A database's fields and views.", "schema(${1:database})"),
  m("blocks", "blocks() -> list", "The blocks there are.", "blocks()"),
  m("flows", "flows() -> list", "The flows there are.", "flows()"),
  m("plugins", "plugins() -> list", "The plugins in the plugins folder.", "plugins()"),
  m("page_delete", "page_delete(page)", "Delete a page and what is below it for good (own permission).", "page_delete(${1:page})"),
  m("block_delete", "block_delete(name)", "Delete a block for good (own permission).", "block_delete(${1:name})"),
  m("flow_delete", "flow_delete(page)", "Delete a flow for good (own permission).", "flow_delete(${1:page})"),
  m("plugin_delete", "plugin_delete(id)", "Delete a plugin's folder (own permission).", "plugin_delete(${1:id})"),
];
const JS_META = [
  m("pageCreate", "await pageCreate(title, {markdown, parent, icon}) -> id", "Make a page (needs permission to make and change pages).", "pageCreate(${1:title})"),
  m("pageUpdate", "await pageUpdate(page, {title, markdown, icon})", "Change a page's title, text (markdown) or icon.", "pageUpdate(${1:page}, {${2:}})"),
  m("pageArchive", "await pageArchive(page)", "Move a page to the trash.", "pageArchive(${1:page})"),
  m("databaseCreate", "await databaseCreate(title, {properties, views, parent, titleName}) -> id", "Make a database with fields and views.", "databaseCreate(${1:title}, {${2:}})"),
  m("databaseAlter", "await databaseAlter(database, ops)", "Change a database's fields and views.", "databaseAlter(${1:database}, [{${2:}}])"),
  m("blockSave", "await blockSave(block) -> name", "Make or change a block for views.", "blockSave(${1:block})"),
  m("flowSave", "await flowSave(flow, {page, parent})", "Make a flow (or change the flow of a page); it gets no permissions.", "flowSave(${1:flow})"),
  m("pluginSave", "await pluginSave(id, manifest, files)", "Write a plugin to the plugins folder; it stays switched off until you turn it on.", "pluginSave(${1:id}, ${2:manifest}, {${3:}})"),
  m("tree", "await tree()", "The page tree: id, parent, kind, title (needs permission to read how Zeff is built).", "tree()"),
  m("schema", "await schema(database)", "A database's fields and views.", "schema(${1:database})"),
  m("blocks", "await blocks()", "The blocks there are.", "blocks()"),
  m("flows", "await flows()", "The flows there are.", "flows()"),
  m("plugins", "await plugins()", "The plugins in the plugins folder.", "plugins()"),
  m("pageDelete", "await pageDelete(page)", "Delete a page and what is below it for good (own permission).", "pageDelete(${1:page})"),
  m("blockDelete", "await blockDelete(name)", "Delete a block for good (own permission).", "blockDelete(${1:name})"),
  m("flowDelete", "await flowDelete(page)", "Delete a flow for good (own permission).", "flowDelete(${1:page})"),
  m("pluginDelete", "await pluginDelete(id)", "Delete a plugin's folder (own permission).", "pluginDelete(${1:id})"),
];

const RUST_JSON = [
  m("get", "get(&self, key) -> &Json", "A field of an object.", "get(${1:\"key\"})"),
  m("at", "at(&self, i) -> &Json", "An element of a list.", "at(${1:0})"),
  m("len", "len(&self) -> usize", "How many elements or fields."),
  m("items", "items(&self) -> Vec<&Json>", "The elements of a list."),
  m("as_f64", "as_f64(&self) -> f64", "A number (NaN when it is none)."),
  m("as_str", "as_str(&self) -> &str", "A text (empty when it is none)."),
  m("cols", "cols(&self) -> Vec<String>", "The columns of an input that is a table."),
  m("rows", "rows(&self) -> Vec<&Json>", "The rows of an input that is a table: each a list, .at(i)."),
];

export type LanguageItems = { top: CompleteItem[]; members: Record<string, CompleteItem[]>; /** Members offered after any dot when the file contains this text (Rust's input(...) values). */ anyDot?: { when: string; items: CompleteItem[] } };

export const COMPLETIONS: Record<string, LanguageItems> = {
  python: {
    top: [
      { label: "sharedStorage", kind: "variable", detail: "shared by the kernels of this page", doc: STORAGE_DOC },
      { label: "zeff", kind: "variable", detail: "read and write Zeff", doc: "Zeff's data: tables, results, Kennzahlen, databases (reading) and publish / add_row / update_row / delete_row (writing) — each behind a permission you give when the code first asks." },
      { label: "inputs", kind: "variable", detail: "what this cell takes in", doc: "The inputs chosen on the cell: inputs[\"Name\"] is a Table (and a variable of that name)." },
      { label: "display", kind: "function", detail: "display(obj)", doc: "Show an object with a rich form (HTML, image, table).", snippet: "display(${1:obj})" },
      { label: "HTML", kind: "class", detail: "HTML(text)", doc: "HTML to show with display().", snippet: "HTML(${1:text})" },
      { label: "Markdown", kind: "class", detail: "Markdown(text)", doc: "Markdown to show with display().", snippet: "Markdown(${1:text})" },
      { label: "Table", kind: "class", detail: "rows of a table of Zeff", doc: "A table of Zeff: .cols, .rows, .records(), .column(name), .df() (pandas)." },
    ],
    members: { sharedStorage: PY_STORAGE, zeff: PY_ZEFF, meta: PY_META },
  },
  javascript: {
    top: [
      { label: "sharedStorage", kind: "variable", detail: "shared by the kernels of this page", doc: STORAGE_DOC },
      { label: "zeff", kind: "variable", detail: "read and write Zeff (await)", doc: "Zeff's data: tables, results, Kennzahlen, databases (reading) and publish / addRow / updateRow / deleteRow (writing) — each behind a permission you give when the code first asks. All calls are async: await them." },
      { label: "inputs", kind: "variable", detail: "what this cell takes in", doc: "The inputs chosen on the cell: inputs[\"Name\"] is a Table (and a variable of that name)." },
      { label: "display", kind: "function", detail: "display(value)", doc: "Show a value (display.html, display.markdown, display.svg, display.png for rich output).", snippet: "display(${1:value})" },
      { label: "Table", kind: "class", detail: "rows of a table of Zeff", doc: "A table of Zeff: .cols, .rows, .records(), .column(name)." },
    ],
    members: {
      sharedStorage: JS_STORAGE,
      zeff: JS_ZEFF,
      meta: JS_META,
      display: [m("html", "display.html(text)", "Rich output: HTML.", "html(${1:text})"), m("markdown", "display.markdown(text)", "Rich output: Markdown.", "markdown(${1:text})"), m("svg", "display.svg(text)", "Rich output: an SVG picture.", "svg(${1:text})"), m("png", "display.png(buffer)", "Rich output: a PNG picture.", "png(${1:buffer})")],
    },
  },
  rust: {
    top: [
      { label: "input", kind: "function", detail: "input(name) -> Json", doc: "What this cell takes in (an input chosen on the cell) as a small JSON value; a table is {cols, rows}.", snippet: "input(${1:\"name\"})" },
      { label: "shared_get", kind: "function", detail: "shared_get(key) -> Option<String>", doc: STORAGE_DOC, snippet: "shared_get(${1:\"key\"})" },
      { label: "shared_set", kind: "function", detail: "shared_set(key, &value)", doc: STORAGE_DOC + " Serialize the value to a String first.", snippet: "shared_set(${1:\"key\"}, &${2:value})" },
      { label: "shared_remove", kind: "function", detail: "shared_remove(key)", doc: "Take a key out of the shared storage.", snippet: "shared_remove(${1:\"key\"})" },
      { label: "shared_keys", kind: "function", detail: "shared_keys() -> Vec<String>", doc: "The keys of the shared storage.", snippet: "shared_keys()" },
      { label: "zeff_return!", kind: "function", detail: "zeff_return!(value)", doc: "Hand a value on as this cell's output (a last expression without ; does the same).", snippet: "zeff_return!(${1:value})" },
      { label: "Json", kind: "class", detail: "enum Json", doc: "A JSON value: Null, Bool, Num, Str, Arr, Obj — what input() gives." },
    ],
    members: {},
    anyDot: { when: "input(", items: RUST_JSON },
  },
};
