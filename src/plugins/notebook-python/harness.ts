/**
 * The program a Python session runs: a small REPL. Each reads one JSON request per line from stdin and
 * answers with lines on stdout that start with a marker only this session knows (ZNB_MARK), so whatever the code itself prints
 * (even from a child process) is never taken for a message. Messages: {id, t:"stream"|"display"|"result"|"error"|"done"|"vars"|"complete"}.
 * Requests: {op:"execute"|"interrupt"|"vars"|"complete"|"shutdown", id, code, pos}. Written to the kernel's folder at start.
 */

export const PYTHON_HARNESS = String.raw`
import sys, os, io, json, ast, base64, threading, queue, traceback, ctypes, subprocess, time

MARK = os.environ["ZNB_MARK"]
_out = sys.__stdout__
try:
    _out.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass
_lock = threading.Lock()

def send(msg):
    with _lock:
        _out.write(MARK + json.dumps(msg, ensure_ascii=False) + "\n")
        _out.flush()

CUR = {"id": None}

class Stream(io.TextIOBase):
    def __init__(self, name):
        self.name = name
    def writable(self):
        return True
    def write(self, s):
        if s:
            send({"id": CUR["id"], "t": "stream", "name": self.name, "text": str(s)})
        return len(s)
    def flush(self):
        pass

G = {"__name__": "__main__", "__builtins__": __builtins__}

def _b64(b):
    return base64.b64encode(b).decode("ascii")

def bundle(o):
    data = {}
    mb = getattr(o, "_repr_mimebundle_", None)
    if callable(mb):
        try:
            r = mb()
            if isinstance(r, tuple):
                r = r[0]
            if isinstance(r, dict):
                for k, v in r.items():
                    data[k] = _b64(v) if isinstance(v, bytes) else v
        except Exception:
            pass
    for mime, meth, binary in (("image/png", "_repr_png_", True), ("image/jpeg", "_repr_jpeg_", True), ("image/svg+xml", "_repr_svg_", False),
                               ("text/html", "_repr_html_", False), ("text/markdown", "_repr_markdown_", False), ("text/latex", "_repr_latex_", False),
                               ("application/json", "_repr_json_", False)):
        if mime in data:
            continue
        f = getattr(o, meth, None)
        if callable(f):
            try:
                v = f()
            except Exception:
                continue
            if v is None:
                continue
            if isinstance(v, tuple):
                v = v[0]
            data[mime] = _b64(v) if isinstance(v, bytes) else v
    if "text/plain" not in data:
        try:
            data["text/plain"] = repr(o)
        except Exception as e:
            data["text/plain"] = "<unprintable %s>" % type(o).__name__
    return data

def display(*objs, **kw):
    for o in objs:
        send({"id": CUR["id"], "t": "display", "data": bundle(o)})

class _Html:
    def __init__(self, s): self.s = s
    def _repr_html_(self): return self.s
class _Md:
    def __init__(self, s): self.s = s
    def _repr_markdown_(self): return self.s
G["display"] = display
G["HTML"] = _Html
G["Markdown"] = _Md

def flush_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        for n in plt.get_fignums():
            fig = plt.figure(n)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            send({"id": CUR["id"], "t": "display", "data": {"image/png": _b64(buf.getvalue()), "text/plain": "<Figure>"}})
        plt.close("all")
    except Exception:
        pass

def shell(line):
    p = subprocess.Popen(line, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    for chunk in iter(lambda: p.stdout.read1(4096), b""):
        send({"id": CUR["id"], "t": "stream", "name": "stdout", "text": chunk.decode("utf-8", "replace")})
    return p.wait()

def preprocess(code):
    lines = code.split("\n")
    out = []
    for ln in lines:
        s = ln.strip()
        if ln.startswith("!"):
            out.append("__import__('builtins').__dict__['_znb_shell'](%r)" % ln[1:])
        elif s.startswith("%pip "):
            out.append("__import__('builtins').__dict__['_znb_shell'](%r)" % (sys.executable + " -m pip " + s[5:]))
        else:
            out.append(ln)
    return "\n".join(out)

import builtins
builtins._znb_shell = shell

import re as _re, keyword as _keyword

_NONE = object()

class _Ret(BaseException):
    # A "return value" at the top of a cell: ends the cell and hands the value on (the cell's output).
    def __init__(self, v=None):
        self.v = v

class _RetT(ast.NodeTransformer):
    def visit_FunctionDef(self, n):
        return n
    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef
    visit_ClassDef = visit_FunctionDef
    def visit_Return(self, n):
        call = ast.Call(func=ast.Name(id="__znb_ret", ctx=ast.Load()), args=[n.value or ast.Constant(value=None)], keywords=[])
        return ast.copy_location(ast.Raise(exc=call, cause=None), n)

G["__znb_ret"] = _Ret

def jsonable(v, depth=0):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return None if v != v or v in (float("inf"), float("-inf")) else v
    if isinstance(v, Table):
        return {"cols": v.cols, "rows": jsonable(v.rows, depth + 1)}
    if depth > 8:
        return repr(v)
    if isinstance(v, (list, tuple, set)):
        return [jsonable(x, depth + 1) for x in v]
    if isinstance(v, dict):
        return {str(k): jsonable(x, depth + 1) for k, x in v.items()}
    if hasattr(v, "columns") and hasattr(v, "values"):
        try:
            return {"cols": [str(c) for c in v.columns], "rows": jsonable(v.values.tolist(), depth + 1)}
        except Exception:
            pass
    if hasattr(v, "tolist"):
        try:
            return jsonable(v.tolist(), depth + 1)
        except Exception:
            pass
    return repr(v)

def bind_inputs(inputs):
    # What the cell reads: inputs["Name"] (a table as Table, else the value), and a variable of that name when it is one.
    G["inputs"] = {}
    for name, payload in (inputs or {}).items():
        v = Table(payload["cols"], payload["rows"], name, payload.get("ids")) if isinstance(payload, dict) and "cols" in payload and "rows" in payload else payload
        G["inputs"][name] = v
        ident = _re.sub(r"\W+", "_", str(name)).strip("_")
        if ident and not ident[0].isdigit() and ident.isidentifier() and not _keyword.iskeyword(ident):
            G[ident] = v

def run_cell(rid, code, inputs=None, shared=None):
    CUR["id"] = rid
    SHARED.clear()
    SHARED.update(shared or {})
    bind_inputs(inputs)
    old = (sys.stdout, sys.stderr)
    sys.stdout, sys.stderr = Stream("stdout"), Stream("stderr")
    status = "ok"
    try:
        src = preprocess(code)
        tree = ast.parse(src, "<cell>", "exec")
        tree = ast.fix_missing_locations(_RetT().visit(tree))
        returned = _NONE
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        try:
            exec(compile(tree, "<cell>", "exec"), G)
        except _Ret as r:
            returned = r.v
            last = None
            if returned is not None:
                G["_"] = returned
                send({"id": rid, "t": "result", "data": bundle(returned)})
        if last is not None:
            v = eval(compile(last, "<cell>", "eval"), G)
            if v is not None:
                G["_"] = v
                returned = v
                send({"id": rid, "t": "result", "data": bundle(v)})
        if returned is not _NONE and returned is not None:
            send({"id": rid, "t": "returned", "value": jsonable(returned)})
        flush_figures()
    except KeyboardInterrupt:
        status = "aborted"
        send({"id": rid, "t": "error", "ename": "KeyboardInterrupt", "evalue": "", "traceback": ["KeyboardInterrupt"]})
    except SystemExit:
        pass
    except BaseException as e:
        status = "error"
        tb = traceback.format_exception(type(e), e, e.__traceback__)
        tb = [l for l in tb if "harness" not in l and "<frozen" not in l]
        send({"id": rid, "t": "error", "ename": type(e).__name__, "evalue": str(e), "traceback": "".join(tb).rstrip("\n").split("\n")})
    finally:
        sys.stdout, sys.stderr = old
        send({"id": rid, "t": "done", "status": status})
        CUR["id"] = None

def variables():
    items = []
    for k, v in list(G.items()):
        if k.startswith("_") or k in ("display", "HTML", "Markdown", "zeff", "Table", "sharedStorage") or isinstance(v, type(sys)):
            continue
        try:
            shape = getattr(v, "shape", None)
            r = repr(v)
        except Exception:
            r, shape = "<unprintable>", None
        items.append({"name": k, "type": type(v).__name__, "preview": (r[:120] + "…") if len(r) > 120 else r, **({"shape": str(shape)} if shape is not None else {}), **({"size": len(v)} if hasattr(v, "__len__") and not isinstance(v, str) else {})})
    return items[:300]

def complete(code, pos):
    import rlcompleter, re
    head = code[:pos]
    m = re.search(r"[A-Za-z_][\w\.]*$", head)
    word = m.group(0) if m else ""
    c = rlcompleter.Completer(G)
    seen, res, i = set(), [], 0
    while i < 200:
        r = c.complete(word, i)
        if r is None:
            break
        r = r.rstrip("(")
        if r not in seen:
            seen.add(r)
            res.append(r)
        i += 1
    return {"from": pos - len(word), "to": pos, "items": res[:80]}

REPLIES = {}
_rid = {"n": 0}

class ZeffError(RuntimeError):
    pass

def _call(op, **args):
    # Asks Zeff (over the same pipe the output goes through): the answer comes back as a "reply" line. The user may be asked first.
    _rid["n"] += 1
    rid = "r%d" % _rid["n"]
    ev = threading.Event()
    REPLIES[rid] = [ev, None]
    send({"id": CUR["id"], "t": "zeff", "rid": rid, "op": op, "args": args})
    while not ev.wait(0.2):
        pass
    res = REPLIES.pop(rid)[1] or {}
    if not res.get("ok"):
        err = str(res.get("error", "failed"))
        if err.startswith("Permission denied"):
            raise PermissionError(err)
        raise ZeffError(err)
    return res.get("value")

import html as _htmllib

class Table:
    """Rows of a table of Zeff: .cols, .rows, .records() (a list of dicts), .column(name), .df() (pandas)."""
    def __init__(self, cols, rows, title=None, ids=None):
        self.cols = list(cols)
        self.rows = [list(r) for r in rows]
        self.title = title
        self.ids = list(ids) if ids else None
    def __len__(self):
        return len(self.rows)
    def __iter__(self):
        return iter(self.records())
    def __getitem__(self, i):
        if isinstance(i, str):
            return self.column(i)
        return self.records()[i]
    def records(self):
        return [dict(zip(self.cols, r)) for r in self.rows]
    def column(self, name):
        i = self.cols.index(name)
        return [r[i] for r in self.rows]
    def df(self):
        import pandas as pd
        return pd.DataFrame(self.rows, columns=self.cols)
    def __repr__(self):
        head = " | ".join(str(c) for c in self.cols)
        lines = [head, "-" * len(head)] + [" | ".join("" if v is None else str(v) for v in r) for r in self.rows[:30]]
        if len(self.rows) > 30:
            lines.append("... %d rows" % len(self.rows))
        return "\n".join(lines)
    def _repr_html_(self):
        e = _htmllib.escape
        th = "".join("<th>%s</th>" % e(str(c)) for c in self.cols)
        body = "".join("<tr>" + "".join("<td>%s</td>" % e("" if v is None else str(v)) for v in r) + "</tr>" for r in self.rows[:200])
        more = "<p>%d rows</p>" % len(self.rows) if len(self.rows) > 200 else ""
        return "<table><thead><tr>%s</tr></thead><tbody>%s</tbody></table>%s" % (th, body, more)

class _Zeff:
    """What the code may read of Zeff — each kind only after you allowed it (Zeff asks when the code first needs it)."""
    def tables(self):
        return _call("tables")
    def table(self, name):
        r = _call("table", name=name)
        return Table(r["cols"], r["rows"], name)
    def metrics(self):
        return {m["label"]: m["value"] for m in _call("metrics")}
    def metric(self, name):
        return _call("metric", name=name)["value"]
    def outputs(self):
        return {o["name"]: o["value"] for o in _call("outputs")}
    def output(self, name):
        return _call("output", name=name)["value"]
    def api(self, method, **params):
        """A method of a Zeff plugin (todos.add, calendar.event.add …; needs its own permission): its result."""
        return _call("api", method=method, params=jsonable(params))
    def ai(self, prompt, json=False, schema=None, minutes=None):
        """Ask the AI (needs permission; it costs tokens): the answer as text, or with json=True as a JSON value; schema=<JSON schema> and minutes=<up to 9> for a long, structured answer (a whole plan)."""
        extra = {}
        if schema is not None:
            extra["schema"] = jsonable(schema)
        if minutes is not None:
            extra["minutes"] = minutes
        return _call("ai", prompt=str(prompt), json=bool(json), **extra)
    def call(self, plugin, name, **args):
        """A function a plugin brings (needs permission): its result."""
        return _call("call", plugin=plugin, name=name, fargs=jsonable(args))
    def databases(self):
        return _call("databases")
    def database(self, name_or_id):
        r = _call("database", name=name_or_id)
        return Table(r["cols"], r["rows"], r.get("title"), r.get("ids"))

    # --- Writing into Zeff: each needs its own permission, asked when the code first does it ---
    def publish(self, name, value, unit=None):
        """A value for all of Zeff: widgets, views and formulas read it (numbers become Kennzahlen)."""
        return _call("publish", name=name, value=jsonable(value), unit=unit)
    def add_row(self, database, fields):
        """A row in a database: fields by name ({"Name": "Anna", "Betrag": 12}); gives the new row id."""
        return _call("add_row", database=database, fields=jsonable(fields))
    def update_row(self, database, row_id, fields):
        return _call("update_row", database=database, id=row_id, fields=jsonable(fields))
    def delete_row(self, database, row_id):
        """A row moved to the trash (it can be brought back there)."""
        return _call("delete_row", database=database, id=row_id)

class _Meta:
    """Zeff's own structure, from code - each kind with a permission of its own (asked when the code first needs it)."""
    def _do(self, op, **args):
        return _call("meta", mop=op, margs=jsonable(args))
    def page_create(self, title, markdown=None, parent=None, icon=None):
        return self._do("page.create", title=title, markdown=markdown, parent=parent, icon=icon)["id"]
    def page_update(self, page, title=None, markdown=None, icon=None):
        return self._do("page.update", id=page, title=title, markdown=markdown, icon=icon)
    def page_archive(self, page):
        return self._do("page.archive", id=page)
    def database_create(self, title, properties=None, views=None, parent=None, icon=None, title_name=None):
        return self._do("database.create", title=title, properties=properties, views=views, parent=parent, icon=icon, titleName=title_name)["id"]
    def database_alter(self, database, ops):
        return self._do("database.alter", database=database, ops=ops)
    def block_save(self, block):
        return self._do("block.save", block=block)["name"]
    def flow_save(self, flow, page=None, parent=None):
        return self._do("flow.save", flow=flow, page=page, parent=parent)
    def plugin_save(self, id, manifest, files=None):
        return self._do("plugin.save", id=id, manifest=manifest, files=files or {})
    # --- reading how Zeff is built (not the rows) ---
    def tree(self):
        return self._do("tree")
    def schema(self, database):
        return self._do("schema", database=database)
    def blocks(self):
        return self._do("blocks.list")
    def flows(self):
        return self._do("flows.list")
    def plugins(self):
        return self._do("plugins.list")
    # --- deleting for good: its own permission ---
    def page_delete(self, page):
        return self._do("page.delete", id=page)
    def block_delete(self, name):
        return self._do("block.delete", name=name)
    def flow_delete(self, page):
        return self._do("flow.delete", page=page)
    def plugin_delete(self, id):
        return self._do("plugin.delete", id=id)

_zeff = _Zeff()
_zeff.meta = _Meta()
G["zeff"] = _zeff
G["Table"] = Table

SHARED = {}

class _SharedStorage:
    """Strings shared by the kernels of this page (Python, Node.js, Rust) - like localStorage: serialize what you put in
    (json.dumps(x)) and parse what you take out (json.loads(s)). Kept with the page, also after a restart."""
    def get(self, key, default=None):
        return SHARED.get(str(key), default)
    def set(self, key, value):
        if not isinstance(value, str):
            raise TypeError("sharedStorage holds strings: serialize the value first, e.g. sharedStorage.set(key, json.dumps(value))")
        key = str(key)
        SHARED[key] = value
        send({"id": CUR["id"], "t": "storage", "op": "set", "key": key, "value": value})
    def remove(self, key):
        key = str(key)
        if SHARED.pop(key, None) is not None:
            send({"id": CUR["id"], "t": "storage", "op": "remove", "key": key})
    def keys(self):
        return list(SHARED.keys())
    def clear(self):
        SHARED.clear()
        send({"id": CUR["id"], "t": "storage", "op": "clear"})
    # localStorage's names, and dict-style
    getItem = get
    setItem = set
    removeItem = remove
    def __getitem__(self, key):
        return SHARED[str(key)]
    def __setitem__(self, key, value):
        self.set(key, value)
    def __delitem__(self, key):
        self.remove(key)
    def __contains__(self, key):
        return str(key) in SHARED
    def __len__(self):
        return len(SHARED)
    def __repr__(self):
        return "sharedStorage(%s)" % ", ".join(sorted(SHARED.keys()))

G["sharedStorage"] = _SharedStorage()

work = queue.Queue()
worker_id = {"v": None}

def worker():
    worker_id["v"] = threading.get_ident()
    while True:
        job = work.get()
        if job is None:
            return
        run_cell(job["id"], job["code"], job.get("inputs"), job.get("shared"))

t = threading.Thread(target=worker, daemon=True)
t.start()
send({"t": "ready", "version": sys.version.split()[0]})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    op = req.get("op")
    if op == "execute":
        work.put(req)
    elif op == "interrupt":
        if worker_id["v"] is not None and CUR["id"] is not None:
            ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(worker_id["v"]), ctypes.py_object(KeyboardInterrupt))
    elif op == "vars":
        try:
            send({"id": req.get("id"), "t": "vars", "items": variables()})
        except Exception as e:
            send({"id": req.get("id"), "t": "vars", "items": []})
    elif op == "complete":
        try:
            send({"id": req.get("id"), "t": "complete", **complete(req.get("code", ""), int(req.get("pos", 0)))})
        except Exception:
            send({"id": req.get("id"), "t": "complete", "from": 0, "to": 0, "items": []})
    elif op == "reply":
        r = REPLIES.get(req.get("rid"))
        if r:
            r[1] = {"ok": req.get("ok"), "value": req.get("value"), "error": req.get("error")}
            r[0].set()
    elif op == "shutdown":
        break
os._exit(0)
`;

