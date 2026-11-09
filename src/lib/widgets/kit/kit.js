/*
 * Zeff's exercise kit — in every widget's frame (lib/widgets/sandbox.ts puts it in): `ZeffKit.mount(el, spec)` turns an
 * exercise set (a plain object, lib/widgets/spec.ts describes it) into a lesson card stack with instant feedback, hints,
 * a second try, the right answer shown when it didn't work out, a summary, "practise the wrong ones again" — and reports
 * it all through zeff.report (score, answers, done). A widget of its own (custom HTML) can use the parts too:
 * ZeffKit.check.* (the checkers), ZeffKit.fmt (text with **bold**, `code` and $math$), ZeffKit.expr (a safe formula
 * evaluator — no eval), ZeffKit.plot (a small SVG function plot).
 *
 * No network, no eval: code exercises run in a Worker made from a blob, ended after 2 s. Every item renders on its own:
 * one that breaks shows a friendly note and is skipped — the rest goes on (and the teacher hears of it).
 *
 * Plain browser JavaScript (no build step); in Node (tests) it exports the pure parts.
 */
(function (root, factory) {
  var kit = factory(typeof document !== "undefined" ? document : null);
  if (typeof module === "object" && module.exports) module.exports = kit;
  else root.ZeffKit = kit;
})(typeof self !== "undefined" ? self : this, function (doc) {
  "use strict";

  // -------------------------------------------------------------------------------------------------------------------
  // Words (the person's language: spec.lang, else the frame's <html lang>)
  // -------------------------------------------------------------------------------------------------------------------
  var WORDS = {
    de: {
      check: "Prüfen", next: "Weiter", hint: "Tipp", again: "Nochmal versuchen", reveal: "Lösung zeigen", right: "Richtig!", almost: "Fast — ", wrong: "Noch nicht ganz.",
      tryAgain: "Versuch es nochmal.", answerWas: "Richtig wäre: ", done: "Geschafft!", of: "von", retryWrong: "Die falschen nochmal üben", restart: "Von vorn",
      item: "Aufgabe", broken: "Diese Aufgabe konnte nicht angezeigt werden — sie wird übersprungen.", skip: "Überspringen", yourAnswer: "Deine Antwort",
      pick: "Wähle …", tapWhere: "Tippe auf: ", run: "Ausführen", running: "Läuft …", passed: "Test bestanden", failed: "Test nicht bestanden", timeout: "Abgebrochen: zu lange (Endlosschleife?)",
      flip: "Umdrehen", knew: "Wusste ich", didnt: "Wusste ich nicht", finish: "Fertig", empty: "Bitte erst antworten.", unitMissing: "Mit Einheit?", tapItem: "Tippe einen Begriff an, dann die Gruppe.",
      moveUp: "nach oben", moveDown: "nach unten", explore: "Probier die Regler aus.", matchCurve: "Bring die Kurve auf die gestrichelte.", value: "Wert", correctAt: "richtig an Stelle",
      points: "Punkte", score: "Ergebnis", restartScenario: "Nochmal von vorn", outcome: "Ergebnis", formulaHelp: "z. B. 2*x^2 + sin(x)", parseError: "Das kann ich nicht lesen: ",
    },
    en: {
      check: "Check", next: "Next", hint: "Hint", again: "Try again", reveal: "Show answer", right: "Right!", almost: "Almost — ", wrong: "Not quite.",
      tryAgain: "Have another go.", answerWas: "The answer: ", done: "Done!", of: "of", retryWrong: "Practise the wrong ones again", restart: "Start over",
      item: "Task", broken: "This task couldn't be shown — it is skipped.", skip: "Skip", yourAnswer: "Your answer",
      pick: "Pick …", tapWhere: "Tap on: ", run: "Run", running: "Running …", passed: "Test passed", failed: "Test failed", timeout: "Stopped: took too long (an endless loop?)",
      flip: "Flip", knew: "I knew it", didnt: "I didn't", finish: "Finish", empty: "Answer first, please.", unitMissing: "With a unit?", tapItem: "Tap a term, then its group.",
      moveUp: "move up", moveDown: "move down", explore: "Try the sliders.", matchCurve: "Bring the curve onto the dashed one.", value: "Value", correctAt: "right at position",
      points: "points", score: "Score", restartScenario: "Start over", outcome: "Outcome", formulaHelp: "e.g. 2*x^2 + sin(x)", parseError: "I can't read this: ",
    },
    es: {
      check: "Comprobar", next: "Siguiente", hint: "Pista", again: "Inténtalo de nuevo", reveal: "Ver solución", right: "¡Correcto!", almost: "Casi — ", wrong: "Todavía no.",
      tryAgain: "Inténtalo otra vez.", answerWas: "La respuesta: ", done: "¡Hecho!", of: "de", retryWrong: "Practicar de nuevo las falladas", restart: "Empezar de nuevo",
      item: "Tarea", broken: "Esta tarea no se pudo mostrar — se salta.", skip: "Saltar", yourAnswer: "Tu respuesta",
      pick: "Elige …", tapWhere: "Toca: ", run: "Ejecutar", running: "Ejecutando …", passed: "Prueba superada", failed: "Prueba no superada", timeout: "Detenido: tardó demasiado (¿un bucle infinito?)",
      flip: "Girar", knew: "Lo sabía", didnt: "No lo sabía", finish: "Terminar", empty: "Responde primero.", unitMissing: "¿Con unidad?", tapItem: "Toca un término y luego su grupo.",
      moveUp: "subir", moveDown: "bajar", explore: "Prueba los controles.", matchCurve: "Lleva la curva a la discontinua.", value: "Valor", correctAt: "correcto en la posición",
      points: "puntos", score: "Resultado", restartScenario: "Empezar de nuevo", outcome: "Resultado", formulaHelp: "p. ej. 2*x^2 + sin(x)", parseError: "No puedo leer esto: ",
    },
  };
  var langOf = function (spec) {
    var l = String((spec && spec.lang) || (doc && doc.documentElement.lang) || "de").slice(0, 2).toLowerCase();
    return WORDS[l] ? l : "en";
  };

  // -------------------------------------------------------------------------------------------------------------------
  // Text: escaped, with **bold**, *italic*, `code`, line breaks and $math$ / $$math$$ (KaTeX when the frame has it)
  // -------------------------------------------------------------------------------------------------------------------
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  function math(tex, display) {
    var K = typeof katex !== "undefined" ? katex : null; // eslint-disable-line no-undef
    if (K) {
      try {
        return K.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
      } catch (e) {
        /* falls through */
      }
    }
    return '<code class="zk-tex">' + esc(tex) + "</code>";
  }
  function fmt(text) {
    var s = String(text == null ? "" : text);
    var out = "";
    var re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    var last = 0;
    var m;
    var inline = function (t) {
      return esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
        .replace(/\n/g, "<br>");
    };
    while ((m = re.exec(s))) {
      out += inline(s.slice(last, m.index)) + (m[1] !== undefined ? math(m[1], true) : math(m[2], false));
      last = re.lastIndex;
    }
    return out + inline(s.slice(last));
  }
  /** What an item is about, in a line: its task — or a scenario's first situation, a card set's first card. */
  var titleOf = function (it) {
    if (it.q) return it.q;
    if (it.text) return it.text;
    if (it.nodes) { var n = it.nodes[it.start || Object.keys(it.nodes)[0]]; if (n && n.text) return n.text; }
    if (it.cards && it.cards[0]) return it.cards[0].front;
    return "";
  };
  /** Plain text of a prompt (for the answers the teacher gets). */
  var plain = function (text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, 280);
  };

  // -------------------------------------------------------------------------------------------------------------------
  // Checkers (pure)
  // -------------------------------------------------------------------------------------------------------------------
  /** "3,5 cm" → { value: 3.5, unit: "cm" } (German decimal comma, thousands spaces, 1.2e3, fractions "3/4"). */
  function parseNumber(input) {
    var s = String(input == null ? "" : input).trim().replace(/−/g, "-").replace(/\s+(?=\d{3}\b)/g, "");
    var m = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)(?:\s*\/\s*(\d+(?:[.,]\d+)?))?\s*(.*)$/i.exec(s);
    if (!m) return null;
    var v = parseFloat(m[1].replace(",", "."));
    if (m[2]) v = v / parseFloat(m[2].replace(",", "."));
    if (!isFinite(v)) return null;
    return { value: v, unit: m[3].trim() };
  }
  var normUnit = function (u) {
    return String(u || "").replace(/\s+/g, "").replace(/²/g, "^2").replace(/³/g, "^3").replace(/µ/g, "u").toLowerCase();
  };
  /**
   * A number answer: within tol (absolute) or rel (relative, 0.01 = 1 %); default: 1e-9 relative. With a unit: the
   * person's unit converted (item.units: { "mm": 0.001 } — factors to the item's unit), none given: counted, said.
   */
  function checkNumber(input, item) {
    var p = parseNumber(input);
    if (!p) return { ok: false, empty: !String(input || "").trim() };
    var v = p.value;
    var note = null;
    if (item.unit) {
      if (!p.unit) note = "unitMissing";
      else if (normUnit(p.unit) !== normUnit(item.unit)) {
        var units = item.units || {};
        var f = null;
        for (var k in units) if (Object.prototype.hasOwnProperty.call(units, k) && normUnit(k) === normUnit(p.unit)) f = Number(units[k]);
        if (f === null || !isFinite(f)) return { ok: false, unitWrong: true };
        v = v * f;
      }
    }
    var want = Number(item.answer);
    var tol = item.tol != null ? Math.abs(Number(item.tol)) : 0;
    var rel = item.rel != null ? Math.abs(Number(item.rel)) : tol ? 0 : 1e-9;
    var diff = Math.abs(v - want);
    var ok = diff <= tol + rel * Math.abs(want) + 1e-12;
    var close = !ok && diff <= 3 * (tol + rel * Math.abs(want)) + 0.05 * Math.abs(want);
    return { ok: ok, close: close, note: ok ? note : null };
  }
  /** Text the same way people mean it: case, spaces, accents, ß/ss and punctuation at the ends don't count. */
  var loose = function (s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss")
      .replace(/\s+/g, " ")
      .replace(/^[\s.,;:!?"'()]+|[\s.,;:!?"'()]+$/g, "");
  };
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var d = [];
    for (var i = 0; i <= a.length; i++) d[i] = [i];
    for (var j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++)
      for (j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  /** A text answer: match "loose" (default — one typo allowed in longer words), "exact", "regex" or "keywords" (all of them in it). */
  function checkText(input, item) {
    var given = String(input == null ? "" : input);
    if (!given.trim()) return { ok: false, empty: true };
    var answers = [].concat(item.answer == null ? [] : item.answer).map(String);
    var mode = item.match || "loose";
    if (mode === "exact") return { ok: answers.indexOf(given.trim()) >= 0 };
    if (mode === "regex") {
      for (var i = 0; i < answers.length; i++) {
        try {
          if (new RegExp(answers[i], "i").test(given)) return { ok: true };
        } catch (e) {
          /* a broken pattern doesn't match */
        }
      }
      return { ok: false };
    }
    if (mode === "keywords") {
      var g = loose(given);
      var missing = answers.filter(function (k) {
        return g.indexOf(loose(k)) < 0;
      });
      return { ok: missing.length === 0, close: missing.length > 0 && missing.length < answers.length, missing: missing };
    }
    var l = loose(given);
    for (var j = 0; j < answers.length; j++) {
      var a = loose(answers[j]);
      if (l === a) return { ok: true };
      if (a.length >= 6 && distance(l, a) <= 1) return { ok: true, typo: true };
    }
    return { ok: false };
  }

  // A formula parser (no eval): + - * / ^, unary minus, parentheses, implicit multiplication (2x, 3(x+1), x y),
  // functions sin cos tan asin acos atan sinh cosh tanh sqrt exp ln log abs floor ceil, constants pi e.
  var FUNS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: function (x) { return Math.log(x) / Math.LN10; }, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  };
  var CONSTS = { pi: Math.PI, e: Math.E };
  function tokenize(src) {
    var s = String(src).replace(/−/g, "-").replace(/[·×]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi").replace(/,/g, ".");
    var out = [];
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      var num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (num) { out.push({ t: "n", v: parseFloat(num[0]) }); i += num[0].length; continue; }
      var id = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(s.slice(i));
      if (id) { out.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
      if ("+-*/^()".indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
      throw new Error("“" + c + "”");
    }
    return out;
  }
  /** A formula as a function of its variables: compile("2x^2", ["x"]) → (vals) => number. Throws on what it can't read. */
  function compile(src, vars) {
    var toks = tokenize(src);
    var known = vars || [];
    // Identifiers split into known names (a variable "xy" isn't there unless named: "xy" → x*y).
    var split = [];
    toks.forEach(function (tk) {
      if (tk.t !== "id" || FUNS[tk.v] || CONSTS[tk.v] !== undefined || known.indexOf(tk.v) >= 0) return split.push(tk);
      var rest = tk.v;
      while (rest) {
        var hit = null;
        var names = known.concat(Object.keys(CONSTS)).concat(Object.keys(FUNS)).sort(function (a, b) { return b.length - a.length; });
        for (var k = 0; k < names.length; k++) if (rest.indexOf(names[k]) === 0) { hit = names[k]; break; }
        if (!hit) throw new Error("“" + tk.v + "”");
        split.push({ t: "id", v: hit });
        rest = rest.slice(hit.length);
      }
    });
    // Implicit multiplication.
    var tk2 = [];
    for (var i = 0; i < split.length; i++) {
      var a = split[i - 1];
      var b = split[i];
      if (a && (a.t === "n" || a.t === ")" || (a.t === "id" && !FUNS[a.v])) && (b.t === "n" || b.t === "(" || b.t === "id")) tk2.push({ t: "*" });
      tk2.push(b);
    }
    var pos = 0;
    var peek = function () { return tk2[pos]; };
    var take = function (t) {
      var k = tk2[pos];
      if (!k || (t && k.t !== t)) throw new Error(t ? "“" + t + "”?" : "…");
      pos++;
      return k;
    };
    // expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-' unary | power ; power := atom ('^' unary)?
    function expr() {
      var l = term();
      while (peek() && (peek().t === "+" || peek().t === "-")) {
        var op = take().t;
        var r = term();
        l = (function (l, r, op) { return op === "+" ? function (v) { return l(v) + r(v); } : function (v) { return l(v) - r(v); }; })(l, r, op);
      }
      return l;
    }
    function term() {
      var l = unary();
      while (peek() && (peek().t === "*" || peek().t === "/")) {
        var op = take().t;
        var r = unary();
        l = (function (l, r, op) { return op === "*" ? function (v) { return l(v) * r(v); } : function (v) { return l(v) / r(v); }; })(l, r, op);
      }
      return l;
    }
    function unary() {
      if (peek() && peek().t === "-") { take(); var u = unary(); return function (v) { return -u(v); }; }
      if (peek() && peek().t === "+") { take(); return unary(); }
      return power();
    }
    function power() {
      var b = atom();
      if (peek() && peek().t === "^") {
        take();
        var e = unary();
        return function (v) { return Math.pow(b(v), e(v)); };
      }
      return b;
    }
    function atom() {
      var k = take();
      if (k.t === "n") return function () { return k.v; };
      if (k.t === "(") { var e = expr(); take(")"); return e; }
      if (k.t === "id") {
        if (FUNS[k.v]) {
          var f = FUNS[k.v];
          var arg;
          if (peek() && peek().t === "(") { take("("); arg = expr(); take(")"); }
          else arg = power();
          return function (v) { return f(arg(v)); };
        }
        if (CONSTS[k.v] !== undefined) return function () { return CONSTS[k.v]; };
        return function (v) {
          if (!(k.v in v)) throw new Error("“" + k.v + "”");
          return v[k.v];
        };
      }
      throw new Error("“" + (k.t === "n" ? k.v : k.t) + "”");
    }
    var fn = expr();
    if (pos < tk2.length) throw new Error("“" + (tk2[pos].v != null ? tk2[pos].v : tk2[pos].t) + "”");
    return fn;
  }
  /**
   * A formula answer: the same function as item.answer — compared at 12 points (vars in item.range, default -3..3,
   * points where either is undefined left out). { ok, error } — error: what couldn't be read.
   */
  function checkFormula(input, item) {
    if (!String(input || "").trim()) return { ok: false, empty: true };
    var vars = item.vars || ["x"];
    var got;
    var want;
    try {
      got = compile(input, vars);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    try {
      want = compile(item.answer, vars);
    } catch (e) {
      return { ok: false, error: "(the exercise's own formula) " + e.message };
    }
    var range = item.range || [-3, 3];
    var seed = 7;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var tested = 0;
    for (var i = 0; i < 40 && tested < 12; i++) {
      var v = {};
      vars.forEach(function (n) { v[n] = range[0] + (range[1] - range[0]) * rnd(); });
      var a;
      var b;
      try { a = got(v); b = want(v); } catch (e) { return { ok: false, error: e.message }; }
      if (!isFinite(a) || !isFinite(b)) continue;
      tested++;
      if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b))) return { ok: false };
    }
    return { ok: tested > 0 };
  }
  /** Cloze: "{{Berlin|berlin}}" a blank (answers), "{{[Paris|*Berlin|Rom]}}" a choice (* the right one). */
  function parseCloze(text) {
    var parts = [];
    var re = /\{\{(.+?)\}\}/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      parts.push({ text: text.slice(last, m.index) });
      var body = m[1].trim();
      if (body[0] === "[" && body[body.length - 1] === "]") {
        var opts = body.slice(1, -1).split("|");
        var right = -1;
        opts = opts.map(function (o, i) {
          o = o.trim();
          if (o[0] === "*") { right = i; return o.slice(1).trim(); }
          return o;
        });
        parts.push({ blank: true, options: opts, answer: right < 0 ? 0 : right });
      } else parts.push({ blank: true, answers: body.split("|").map(function (x) { return x.trim(); }) });
      last = re.lastIndex;
    }
    parts.push({ text: text.slice(last) });
    return parts;
  }
  /** The answer as the person should see it after the tries. */
  function answerText(item) {
    switch (item.type) {
      case "choice":
        return [].concat(item.answer).map(function (i) { return item.options[i]; }).join(", ");
      case "number":
      case "slider":
        return item.answer + (item.unit ? " " + item.unit : "");
      case "text":
        return [].concat(item.answer)[0];
      case "formula":
        return item.answer;
      case "order":
        return item.items.join(" → ");
      case "match":
        return item.pairs.map(function (p) { return p[0] + " – " + p[1]; }).join("; ");
      case "categorize":
        return Object.keys(item.groups).map(function (g) { return g + ": " + item.groups[g].join(", "); }).join(" · ");
      default:
        return "";
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Look
  // -------------------------------------------------------------------------------------------------------------------
  var CSS =
    ".zk{--zk-accent:#6d28d9;--zk-ok:#15803d;--zk-bad:#b91c1c;--zk-warn:#b45309;--zk-line:#e4e4e7;--zk-soft:#f4f4f5;--zk-card:#fff;--zk-muted:#52525b;max-width:720px;margin:0 auto}" +
    ":root[style*='dark'] .zk,.zk.dark{--zk-accent:#a78bfa;--zk-ok:#4ade80;--zk-bad:#f87171;--zk-warn:#fbbf24;--zk-line:#3f3f46;--zk-soft:#27272a;--zk-card:#18181b;--zk-muted:#a1a1aa}" +
    ".zk *{box-sizing:border-box}.zk-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}.zk-title{font-weight:650;font-size:17px;flex:1}" +
    ".zk-bar{height:6px;border-radius:3px;background:var(--zk-soft);overflow:hidden;margin-bottom:12px}.zk-bar>i{display:block;height:100%;background:var(--zk-accent);transition:width .3s}" +
    ".zk-count{font-size:13px;color:var(--zk-muted)}.zk-q{font-size:16px;margin:0 0 12px}.zk-intro{color:var(--zk-muted);margin:0 0 12px}" +
    ".zk-btn{min-height:44px;padding:8px 16px;border-radius:10px;border:1px solid var(--zk-line);background:var(--zk-card);color:inherit;cursor:pointer;font:inherit}" +
    ".zk-btn:disabled{opacity:.45;cursor:default}.zk-btn.pri{background:var(--zk-accent);border-color:var(--zk-accent);color:#fff;font-weight:600}.zk-btn:focus-visible,.zk-opt:focus-visible{outline:3px solid var(--zk-accent);outline-offset:2px}" +
    ".zk-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}.zk-opts{display:grid;gap:8px}" +
    ".zk-opt{display:flex;gap:10px;align-items:flex-start;text-align:left;min-height:48px;padding:10px 12px;border-radius:10px;border:2px solid var(--zk-line);background:var(--zk-card);color:inherit;cursor:pointer;font:inherit;width:100%}" +
    ".zk-opt.sel{border-color:var(--zk-accent)}.zk-opt.ok{border-color:var(--zk-ok);background:color-mix(in srgb,var(--zk-ok) 10%,transparent)}.zk-opt.bad{border-color:var(--zk-bad);background:color-mix(in srgb,var(--zk-bad) 10%,transparent)}" +
    ".zk-in{font:inherit;font-size:16px;min-height:44px;padding:8px 12px;border-radius:10px;border:2px solid var(--zk-line);background:var(--zk-card);color:inherit;width:100%;max-width:340px}" +
    ".zk-in.ok{border-color:var(--zk-ok)}.zk-in.bad{border-color:var(--zk-bad)}textarea.zk-in{max-width:none;font-family:ui-monospace,Consolas,monospace;font-size:14px;min-height:150px;tab-size:2}" +
    ".zk-fb{margin-top:12px;padding:10px 12px;border-radius:10px;border-left:4px solid var(--zk-line);background:var(--zk-soft)}.zk-fb.ok{border-color:var(--zk-ok)}.zk-fb.bad{border-color:var(--zk-bad)}.zk-fb.warn{border-color:var(--zk-warn)}" +
    ".zk-fb b.t{display:block;margin-bottom:2px}.zk-hint{margin-top:10px;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,var(--zk-accent) 9%,transparent)}" +
    ".zk-list{list-style:none;padding:0;margin:0;display:grid;gap:6px}.zk-li{display:flex;align-items:center;gap:8px;padding:6px 8px;border:2px solid var(--zk-line);border-radius:10px;background:var(--zk-card)}" +
    ".zk-li.ok{border-color:var(--zk-ok)}.zk-li.bad{border-color:var(--zk-bad)}.zk-li span{flex:1}.zk-mini{min-width:40px;min-height:40px;border-radius:8px;border:1px solid var(--zk-line);background:var(--zk-soft);color:inherit;cursor:pointer;font-size:16px}" +
    ".zk-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}.zk-chip{min-height:40px;padding:6px 12px;border-radius:20px;border:2px solid var(--zk-line);background:var(--zk-card);color:inherit;cursor:pointer;font:inherit}" +
    ".zk-chip.sel{border-color:var(--zk-accent);background:color-mix(in srgb,var(--zk-accent) 12%,transparent)}.zk-chip.ok{border-color:var(--zk-ok)}.zk-chip.bad{border-color:var(--zk-bad)}" +
    ".zk-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.zk-group{min-height:90px;padding:8px;border:2px dashed var(--zk-line);border-radius:12px;cursor:pointer}.zk-group h4{margin:0 0 6px;font-size:14px}" +
    ".zk-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;margin-bottom:6px}.zk-pair select{max-width:none}" +
    ".zk-media{margin:0 0 12px;text-align:center}.zk-media svg,.zk-media img{max-width:100%;height:auto}.zk-spot{position:relative;display:block;width:100%;max-width:520px;margin:0 auto;touch-action:manipulation;cursor:crosshair}.zk-spot img,.zk-spot svg{display:block;width:100%;height:auto}" +
    ".zk-mark{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid var(--zk-accent);background:color-mix(in srgb,var(--zk-accent) 25%,transparent);pointer-events:none}.zk-mark.ok{border-color:var(--zk-ok)}.zk-mark.bad{border-color:var(--zk-bad)}" +
    ".zk-range{width:100%;max-width:420px;min-height:36px;accent-color:var(--zk-accent)}.zk-val{font-weight:650;font-variant-numeric:tabular-nums}" +
    ".zk-tests{margin-top:10px;font-family:ui-monospace,Consolas,monospace;font-size:13px}.zk-tests div{padding:3px 0}.zk-card{min-height:150px;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;border:2px solid var(--zk-line);border-radius:14px;font-size:17px;cursor:pointer}" +
    ".zk-table{border-collapse:collapse;width:100%;overflow-x:auto;display:block}.zk-table th,.zk-table td{border:1px solid var(--zk-line);padding:6px;text-align:left}.zk-table input{min-height:38px;max-width:140px}" +
    ".zk-sum{text-align:center;padding:10px}.zk-big{font-size:40px;font-weight:700}.zk-sumlist{text-align:left;margin:12px auto;max-width:520px;padding:0;list-style:none}.zk-sumlist li{padding:4px 0;border-bottom:1px solid var(--zk-line)}" +
    ".zk-plot{width:100%;max-width:520px;border:1px solid var(--zk-line);border-radius:10px;background:var(--zk-card)}.zk-param{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;max-width:520px}" +
    ".zk-broken{padding:10px 12px;border-radius:10px;border-left:4px solid var(--zk-warn);background:var(--zk-soft)}.zk-pop{animation:zkpop .25s}@keyframes zkpop{0%{transform:scale(.97)}60%{transform:scale(1.02)}100%{transform:none}}" +
    "@media (prefers-reduced-motion:reduce){.zk-pop{animation:none}.zk-bar>i{transition:none}}";

  // -------------------------------------------------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------------------------------------------------
  function h(tag, props) {
    var n = doc.createElement(tag);
    if (props)
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k) || props[k] == null) continue;
        if (k === "html") n.innerHTML = props[k];
        else if (k === "text") n.textContent = props[k];
        else if (k === "cls") n.className = props[k];
        else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), props[k]);
        else if (k in n && k !== "list" && k !== "style") n[k] = props[k];
        else n.setAttribute(k, props[k]);
      }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(typeof x === "string" ? doc.createTextNode(x) : x); });
      else n.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
    }
    return n;
  }
  var shuffled = function (arr, seed) {
    var a = arr.slice();
    var s = seed || 1;
    for (var i = a.length - 1; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      var j = s % (i + 1);
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  };
  var seedOf = function (str) {
    var x = 7;
    for (var i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) % 2147483647;
    return x || 7;
  };
  /** A picture for an item: inline SVG (as written) or a data: image. */
  function media(m) {
    if (!m) return null;
    if (typeof m === "string" && /^\s*<svg[\s>]/i.test(m)) return h("div", { cls: "zk-media", html: m.replace(/<script[\s\S]*?<\/script>/gi, "") });
    if (typeof m === "string" && /^data:image\//.test(m)) return h("div", { cls: "zk-media" }, h("img", { src: m, alt: "" }));
    return null;
  }
  /** An SVG plot of y = f(x) (a compiled formula or a JS function) — the kit's own, no library needed. */
  function plot(opts) {
    var W = 520;
    var H = opts.height || 300;
    var xs = opts.x || [-5, 5];
    var ys = opts.y || [-5, 5];
    var px = function (x) { return ((x - xs[0]) / (xs[1] - xs[0])) * W; };
    var py = function (y) { return H - ((y - ys[0]) / (ys[1] - ys[0])) * H; };
    var ns = "http://www.w3.org/2000/svg";
    var svg = doc.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "zk-plot");
    var add = function (tag, attrs) {
      var e = doc.createElementNS(ns, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      svg.appendChild(e);
      return e;
    };
    var stepOf = function (span) { var p = Math.pow(10, Math.floor(Math.log(span / 8) / Math.LN10)); return span / p > 40 ? p * 5 : span / p > 16 ? p * 2 : p; };
    var sx = stepOf(xs[1] - xs[0]);
    var sy = stepOf(ys[1] - ys[0]);
    for (var gx = Math.ceil(xs[0] / sx) * sx; gx <= xs[1]; gx += sx) add("line", { x1: px(gx), x2: px(gx), y1: 0, y2: H, stroke: "currentColor", "stroke-opacity": 0.08 });
    for (var gy = Math.ceil(ys[0] / sy) * sy; gy <= ys[1]; gy += sy) add("line", { x1: 0, x2: W, y1: py(gy), y2: py(gy), stroke: "currentColor", "stroke-opacity": 0.08 });
    if (ys[0] < 0 && ys[1] > 0) add("line", { x1: 0, x2: W, y1: py(0), y2: py(0), stroke: "currentColor", "stroke-opacity": 0.45 });
    if (xs[0] < 0 && xs[1] > 0) add("line", { x1: px(0), x2: px(0), y1: 0, y2: H, stroke: "currentColor", "stroke-opacity": 0.45 });
    var curves = [];
    svg.curve = function (f, style) {
      var path = add("path", { fill: "none", stroke: style && style.color ? style.color : "var(--zk-accent,#6d28d9)", "stroke-width": style && style.width ? style.width : 2.5, "stroke-dasharray": style && style.dashed ? "7 6" : "none" });
      var draw = function (fn) {
        var d = "";
        var pen = false;
        for (var i = 0; i <= 400; i++) {
          var x = xs[0] + ((xs[1] - xs[0]) * i) / 400;
          var y;
          try { y = fn(x); } catch (e) { y = NaN; }
          if (!isFinite(y) || y < ys[0] - (ys[1] - ys[0]) || y > ys[1] + (ys[1] - ys[0])) { pen = false; continue; }
          d += (pen ? "L" : "M") + px(x).toFixed(1) + " " + py(y).toFixed(1);
          pen = true;
        }
        path.setAttribute("d", d);
      };
      draw(f);
      curves.push(path);
      return { update: draw };
    };
    return svg;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The items: each renders into a card and gives { read(), show(result, final) } — read() → { ok, credit?, answer, ... }
  // -------------------------------------------------------------------------------------------------------------------
  var ITEMS = {};

  ITEMS.choice = function (item, box, W) {
    var multi = Array.isArray(item.answer);
    var right = [].concat(item.answer);
    var order = item.shuffle === false ? item.options.map(function (_, i) { return i; }) : shuffled(item.options.map(function (_, i) { return i; }), seedOf(item.q + item.options.join()));
    var picked = [];
    var btns = {};
    var list = h("div", { cls: "zk-opts", role: multi ? "group" : "radiogroup" });
    order.forEach(function (i) {
      var b = h("button", { type: "button", cls: "zk-opt", "aria-pressed": "false", html: '<span aria-hidden="true">' + (multi ? "☐" : "○") + "</span><span>" + fmt(item.options[i]) + "</span>" });
      b.addEventListener("click", function () {
        if (box.locked) return;
        if (multi) {
          var at = picked.indexOf(i);
          if (at >= 0) picked.splice(at, 1);
          else picked.push(i);
        } else picked = [i];
        Object.keys(btns).forEach(function (k) {
          var on = picked.indexOf(Number(k)) >= 0;
          btns[k].classList.toggle("sel", on);
          btns[k].setAttribute("aria-pressed", String(on));
          btns[k].firstChild.textContent = multi ? (on ? "☑" : "☐") : on ? "●" : "○";
        });
        // A single choice is checked at once (instant feedback).
        if (!multi && box.autoCheck) box.autoCheck();
      });
      btns[i] = b;
      list.appendChild(b);
    });
    box.appendChild(list);
    return {
      instant: !multi,
      read: function () {
        if (!picked.length) return { empty: true };
        var ok = picked.length === right.length && picked.every(function (p) { return right.indexOf(p) >= 0; });
        var hits = picked.filter(function (p) { return right.indexOf(p) >= 0; }).length;
        return {
          ok: ok,
          close: multi && !ok && hits > 0,
          answer: picked.map(function (p) { return item.options[p]; }).join(", "),
          why: !ok && !multi && item.why && item.why[picked[0]] ? item.why[picked[0]] : null,
        };
      },
      show: function (r, final) {
        Object.keys(btns).forEach(function (k) {
          var i = Number(k);
          btns[k].classList.remove("ok", "bad");
          if (picked.indexOf(i) >= 0) btns[k].classList.add(right.indexOf(i) >= 0 ? "ok" : "bad");
          else if (final && right.indexOf(i) >= 0) btns[k].classList.add("ok");
        });
      },
      reset: function () { picked = []; Object.keys(btns).forEach(function (k) { btns[k].classList.remove("ok", "bad", "sel"); btns[k].firstChild.textContent = multi ? "☐" : "○"; }); },
    };
  };

  function inputItem(item, box, W, check, placeholder) {
    var inp = h("input", { cls: "zk-in", type: "text", inputMode: item.type === "number" ? "decimal" : "text", autocomplete: "off", spellcheck: false, placeholder: placeholder || "", "aria-label": W.yourAnswer });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && box.submit) box.submit(); });
    box.appendChild(h("div", null, inp, item.unit && item.type !== "number" ? " " + item.unit : null));
    return {
      focus: inp,
      read: function () {
        var r = check(inp.value, item);
        r.answer = inp.value.trim();
        return r;
      },
      show: function (r) { inp.classList.remove("ok", "bad"); inp.classList.add(r.ok ? "ok" : "bad"); },
      reset: function () { inp.value = ""; inp.classList.remove("ok", "bad"); },
    };
  }
  ITEMS.number = function (item, box, W) {
    return inputItem(item, box, W, checkNumber, item.unit ? "… " + item.unit : "");
  };
  ITEMS.text = function (item, box, W) {
    if (item.long) {
      var ta = h("textarea", { cls: "zk-in", rows: 4, "aria-label": W.yourAnswer, style: "font-family:inherit;font-size:15px;min-height:96px" });
      box.appendChild(ta);
      return {
        focus: ta,
        read: function () { var r = checkText(ta.value, item); r.answer = ta.value.trim(); return r; },
        show: function (r) { ta.classList.remove("ok", "bad"); ta.classList.add(r.ok ? "ok" : "bad"); },
        reset: function () { ta.value = ""; },
      };
    }
    return inputItem(item, box, W, checkText, "");
  };
  ITEMS.formula = function (item, box, W) {
    var preview = h("div", { cls: "zk-intro", style: "min-height:24px;margin-top:8px" });
    var api = inputItem(item, box, W, checkFormula, (item.vars ? item.vars.join(", ") + ": " : "") + W.formulaHelp);
    api.focus.addEventListener("input", function () {
      var v = api.focus.value.trim();
      if (!v) { preview.innerHTML = ""; return; }
      try {
        compile(v, item.vars || ["x"]);
        preview.innerHTML = math(v.replace(/\*/g, "\\cdot ").replace(/sqrt\(([^()]*)\)/g, "\\sqrt{$1}").replace(/\bpi\b/g, "\\pi "), false);
      } catch (e) {
        preview.textContent = W.parseError + e.message;
      }
    });
    box.appendChild(preview);
    return api;
  };
  ITEMS.slider = function (item, box, W) {
    var min = Number(item.min);
    var max = Number(item.max);
    var start = item.start != null ? Number(item.start) : (min + max) / 2;
    var out = h("span", { cls: "zk-val" });
    var r = h("input", { type: "range", cls: "zk-range", min: min, max: max, step: item.step || (max - min) / 100, value: start, "aria-label": W.value });
    var label = function () { out.textContent = Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 6 }) + (item.unit ? " " + item.unit : ""); };
    r.addEventListener("input", label);
    label();
    box.appendChild(h("div", { cls: "zk-row" }, r, out));
    return {
      read: function () {
        var c = checkNumber(String(r.value), { answer: item.answer, tol: item.tol != null ? item.tol : (max - min) / 50, rel: item.rel });
        c.answer = r.value + (item.unit ? " " + item.unit : "");
        return c;
      },
      show: function () {},
      reset: function () { r.value = start; label(); },
    };
  };
  ITEMS.cloze = function (item, box, W) {
    var parts = parseCloze(String(item.text || ""));
    var fields = [];
    var p = h("div", { cls: "zk-q", style: "line-height:2.4" });
    parts.forEach(function (x) {
      if (!x.blank) { p.insertAdjacentHTML("beforeend", fmt(x.text)); return; }
      var f;
      if (x.options) {
        f = h("select", { cls: "zk-in", style: "width:auto;display:inline-block;min-height:40px", "aria-label": W.yourAnswer }, h("option", { value: "", text: W.pick }), x.options.map(function (o, i) { return h("option", { value: String(i), text: o }); }));
      } else {
        var longest = x.answers.reduce(function (a, b) { return Math.max(a, b.length); }, 3);
        f = h("input", { cls: "zk-in", style: "width:" + Math.min(16, longest + 3) + "ch;display:inline-block;min-height:40px", autocomplete: "off", spellcheck: false, "aria-label": W.yourAnswer });
      }
      fields.push({ el: f, def: x });
      p.appendChild(f);
    });
    box.appendChild(p);
    var each = function () {
      return fields.map(function (f) {
        var v = f.el.value;
        if (f.def.options) return { ok: v !== "" && Number(v) === f.def.answer, empty: v === "", a: v === "" ? "" : f.def.options[Number(v)] };
        var c = checkText(v, { answer: f.def.answers, match: item.match });
        return { ok: c.ok, empty: !v.trim(), a: v.trim() };
      });
    };
    return {
      read: function () {
        var r = each();
        if (r.every(function (x) { return x.empty; })) return { empty: true };
        var right = r.filter(function (x) { return x.ok; }).length;
        return { ok: right === r.length, close: right > 0, credit: right / r.length, answer: r.map(function (x) { return x.a || "—"; }).join(" | ") };
      },
      show: function (res, final) {
        var r = each();
        fields.forEach(function (f, i) {
          f.el.classList.remove("ok", "bad");
          f.el.classList.add(r[i].ok ? "ok" : "bad");
          if (final && !r[i].ok) {
            if (f.def.options) f.el.value = String(f.def.answer);
            else { f.el.value = f.def.answers[0]; }
          }
        });
      },
      reset: function () { fields.forEach(function (f) { f.el.value = ""; f.el.classList.remove("ok", "bad"); }); },
      answerText: parts.filter(function (x) { return x.blank; }).map(function (x) { return x.options ? x.options[x.answer] : x.answers[0]; }).join(" | "),
    };
  };
  ITEMS.order = function (item, box, W) {
    var start = shuffled(item.items.map(function (_, i) { return i; }), seedOf(item.items.join("|")));
    if (start.every(function (v, i) { return v === i; }) && start.length > 1) start.reverse();
    var now = start.slice();
    var ul = h("ul", { cls: "zk-list" });
    var draw = function (marks) {
      ul.innerHTML = "";
      now.forEach(function (idx, pos) {
        var up = h("button", { type: "button", cls: "zk-mini", text: "▲", "aria-label": W.moveUp, disabled: pos === 0 || box.locked });
        var down = h("button", { type: "button", cls: "zk-mini", text: "▼", "aria-label": W.moveDown, disabled: pos === now.length - 1 || box.locked });
        up.onclick = function () { var t = now[pos - 1]; now[pos - 1] = now[pos]; now[pos] = t; draw(); };
        down.onclick = function () { var t = now[pos + 1]; now[pos + 1] = now[pos]; now[pos] = t; draw(); };
        ul.appendChild(h("li", { cls: "zk-li" + (marks ? (marks[pos] ? " ok" : " bad") : "") }, h("b", { text: pos + 1 + "." }), h("span", { html: fmt(item.items[idx]) }), up, down));
      });
    };
    draw();
    box.appendChild(ul);
    return {
      read: function () {
        var right = now.filter(function (v, i) { return v === i; }).length;
        return { ok: right === now.length, close: right >= now.length / 2, credit: right / now.length, answer: now.map(function (i) { return item.items[i]; }).join(" → ") };
      },
      show: function (r, final) {
        if (final && !r.ok) now = item.items.map(function (_, i) { return i; });
        draw(now.map(function (v, i) { return v === i; }));
      },
      reset: function () { now = start.slice(); draw(); },
    };
  };
  ITEMS.match = function (item, box, W) {
    var rights = shuffled(item.pairs.map(function (p) { return p[1]; }), seedOf(JSON.stringify(item.pairs)));
    var sels = item.pairs.map(function (p) {
      var s = h("select", { cls: "zk-in", "aria-label": p[0] }, h("option", { value: "", text: W.pick }), rights.map(function (r) { return h("option", { value: r, text: r }); }));
      box.appendChild(h("div", { cls: "zk-pair" }, h("div", { html: fmt(p[0]) }), s));
      return s;
    });
    return {
      read: function () {
        if (sels.every(function (s) { return !s.value; })) return { empty: true };
        var right = sels.filter(function (s, i) { return s.value === item.pairs[i][1]; }).length;
        return { ok: right === sels.length, close: right > 0, credit: right / sels.length, answer: sels.map(function (s, i) { return item.pairs[i][0] + " – " + (s.value || "—"); }).join("; ") };
      },
      show: function (r, final) {
        sels.forEach(function (s, i) {
          var ok = s.value === item.pairs[i][1];
          s.classList.remove("ok", "bad");
          s.classList.add(ok ? "ok" : "bad");
          if (final && !ok) s.value = item.pairs[i][1];
        });
      },
      reset: function () { sels.forEach(function (s) { s.value = ""; s.classList.remove("ok", "bad"); }); },
    };
  };
  ITEMS.categorize = function (item, box, W) {
    var groups = Object.keys(item.groups);
    var all = [];
    groups.forEach(function (g) { item.groups[g].forEach(function (x) { all.push({ text: x, group: g }); }); });
    all = shuffled(all, seedOf(JSON.stringify(item.groups)));
    var where = all.map(function () { return null; });
    var sel = null;
    var pool = h("div", { cls: "zk-chips" });
    var grid = h("div", { cls: "zk-groups" });
    var boxes = {};
    var marks = null;
    var chip = function (i) {
      var c = h("button", { type: "button", cls: "zk-chip" + (sel === i ? " sel" : "") + (marks ? (marks[i] ? " ok" : " bad") : ""), html: fmt(all[i].text) });
      c.onclick = function (e) {
        e.stopPropagation();
        if (box.locked) return;
        sel = sel === i ? null : i;
        draw();
      };
      return c;
    };
    function draw() {
      pool.innerHTML = "";
      all.forEach(function (_, i) { if (where[i] === null) pool.appendChild(chip(i)); });
      groups.forEach(function (g) {
        var b = boxes[g];
        b.list.innerHTML = "";
        all.forEach(function (_, i) { if (where[i] === g) b.list.appendChild(chip(i)); });
      });
    }
    groups.forEach(function (g) {
      var list = h("div", { cls: "zk-chips", style: "margin:0" });
      var el = h("div", { cls: "zk-group", role: "button", tabindex: "0", "aria-label": g }, h("h4", { html: fmt(g) }), list);
      var drop = function () {
        if (box.locked || sel === null) return;
        where[sel] = where[sel] === g ? null : g;
        sel = null;
        draw();
      };
      el.addEventListener("click", drop);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drop(); } });
      boxes[g] = { el: el, list: list };
      grid.appendChild(el);
    });
    box.appendChild(h("p", { cls: "zk-intro", text: W.tapItem }));
    box.appendChild(pool);
    box.appendChild(grid);
    pool.addEventListener("click", function () { if (sel !== null && where[sel] !== null) { where[sel] = null; sel = null; draw(); } });
    draw();
    return {
      read: function () {
        if (where.every(function (w) { return w === null; })) return { empty: true };
        var right = all.filter(function (x, i) { return where[i] === x.group; }).length;
        return { ok: right === all.length, close: right >= all.length / 2, credit: right / all.length, answer: groups.map(function (g) { return g + ": " + all.filter(function (_, i) { return where[i] === g; }).map(function (x) { return x.text; }).join(", "); }).join(" · ") };
      },
      show: function (r, final) {
        if (final) all.forEach(function (x, i) { where[i] = x.group; });
        marks = all.map(function (x, i) { return where[i] === x.group; });
        draw();
      },
      reset: function () { where = all.map(function () { return null; }); marks = null; sel = null; draw(); },
    };
  };
  ITEMS.hotspot = function (item, box, W) {
    // Find each spot on the picture in turn: "Tap on: the trunk" — a tap within its radius (in % of the width) counts.
    var wrap = h("div", { cls: "zk-spot" });
    var pic = media(item.image);
    if (!pic) throw new Error("hotspot: image must be inline <svg> or a data:image URL");
    wrap.appendChild(pic.firstChild);
    var k = 0;
    var results = [];
    var ask = h("p", { cls: "zk-q", style: "font-weight:600" });
    var spots = item.spots;
    var say = function () { ask.textContent = k < spots.length ? W.tapWhere + spots[k].label + " (" + (k + 1) + "/" + spots.length + ")" : "✓"; };
    wrap.addEventListener("click", function (e) {
      if (box.locked || k >= spots.length) return;
      var rect = wrap.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      var s = spots[k];
      var r = s.r || 8;
      var ok = Math.hypot(x - s.x, ((y - s.y) * rect.height) / rect.width) <= r;
      results.push({ ok: ok, label: s.label });
      wrap.appendChild(h("i", { cls: "zk-mark " + (ok ? "ok" : "bad"), style: "left:" + x + "%;top:" + y + "%" }));
      if (!ok) wrap.appendChild(h("i", { cls: "zk-mark ok", style: "left:" + s.x + "%;top:" + s.y + "%;border-style:dashed" }));
      k++;
      say();
      if (k >= spots.length && box.autoCheck) box.autoCheck();
    });
    box.appendChild(ask);
    box.appendChild(h("div", { cls: "zk-media" }, wrap));
    say();
    return {
      instant: true,
      read: function () {
        if (k < spots.length) return { empty: true };
        var right = results.filter(function (r) { return r.ok; }).length;
        return { ok: right === spots.length, close: right > 0, credit: right / spots.length, answer: results.map(function (r) { return r.label + (r.ok ? " ✓" : " ✗"); }).join(", ") };
      },
      show: function () {},
      reset: function () { k = 0; results = []; Array.prototype.slice.call(wrap.querySelectorAll(".zk-mark")).forEach(function (m) { m.remove(); }); say(); },
      once: true,
    };
  };
  ITEMS.code = function (item, box, W) {
    var ta = h("textarea", { cls: "zk-in", spellcheck: false, autocapitalize: "off", "aria-label": W.yourAnswer });
    ta.value = item.starter || "";
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Tab") { e.preventDefault(); var s = ta.selectionStart; ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; }
    });
    var out = h("div", { cls: "zk-tests" });
    box.appendChild(ta);
    box.appendChild(out);
    var last = null;
    return {
      async: true,
      read: function () {
        return runCode(ta.value, item.tests || []).then(function (res) {
          last = res;
          var passed = res.filter(function (r) { return r.ok; }).length;
          return { ok: res.length > 0 && passed === res.length, close: passed > 0, credit: res.length ? passed / res.length : 0, answer: ta.value.slice(0, 280), empty: !ta.value.trim() };
        });
      },
      show: function () {
        out.innerHTML = "";
        (last || []).forEach(function (r) {
          out.appendChild(h("div", { style: "color:var(--zk-" + (r.ok ? "ok" : "bad") + ")", text: (r.ok ? "✓ " : "✗ ") + r.call + (r.ok ? "" : r.error ? "  → " + r.error : "  → " + r.got + " (≠ " + r.want + ")") }));
        });
      },
      reset: function () { ta.value = item.starter || ""; out.innerHTML = ""; },
      answerText: item.solution || "",
    };
  };
  /** The person's code against its tests, in a Worker (a blob — no eval here), ended after 2 s. */
  function runCode(code, tests) {
    return new Promise(function (resolve) {
      // Each test call is written into the worker as code (the person's own code is there anyway).
      var calls = tests
        .map(function (t, i) {
          return "try{var v" + i + "=(" + t.call + ");out.push({i:" + i + ",got:JSON.stringify(v" + i + ")});}catch(e){out.push({i:" + i + ",error:String(e&&e.message||e)});}";
        })
        .join("");
      var body = code + "\n;self.onmessage=function(){var out=[];" + calls + "self.postMessage(out);};";
      var w;
      var url;
      try {
        url = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
        w = new Worker(url);
      } catch (e) {
        return resolve(tests.map(function (t) { return { call: t.call, ok: false, error: "can't run code here: " + e.message }; }));
      }
      var timer = setTimeout(function () {
        w.terminate();
        resolve(tests.map(function (t) { return { call: t.call, ok: false, error: WORDS[langOf()].timeout }; }));
      }, 2000);
      w.onmessage = function (e) {
        clearTimeout(timer);
        w.terminate();
        URL.revokeObjectURL(url);
        resolve(
          e.data.map(function (r) {
            var t = tests[r.i];
            var want = JSON.stringify(t.expect);
            return r.error ? { call: t.call, ok: false, error: r.error } : { call: t.call, ok: r.got === want || (typeof t.expect === "number" && Math.abs(Number(r.got) - t.expect) < 1e-9), got: r.got, want: want };
          }),
        );
      };
      w.onerror = function (e) {
        clearTimeout(timer);
        w.terminate();
        e.preventDefault && e.preventDefault();
        resolve(tests.map(function (t) { return { call: t.call, ok: false, error: e.message || "error" }; }));
      };
      w.postMessage(1);
    });
  }
  ITEMS.table = function (item, box, W) {
    // Cells: text (shown) or { answer, tol?, unit?, match? } — an input.
    var fields = [];
    var tbl = h("table", { cls: "zk-table" });
    if (item.columns) tbl.appendChild(h("tr", null, item.columns.map(function (c) { return h("th", { html: fmt(c) }); })));
    item.rows.forEach(function (row) {
      tbl.appendChild(
        h("tr", null, row.map(function (cell) {
          if (cell && typeof cell === "object") {
            var inp = h("input", { cls: "zk-in", autocomplete: "off", inputMode: typeof cell.answer === "number" ? "decimal" : "text", "aria-label": W.yourAnswer });
            fields.push({ el: inp, cell: cell });
            return h("td", null, inp);
          }
          return h("td", { html: fmt(cell) });
        })),
      );
    });
    box.appendChild(tbl);
    var each = function () {
      return fields.map(function (f) {
        var c = typeof f.cell.answer === "number" ? checkNumber(f.el.value, f.cell) : checkText(f.el.value, f.cell);
        return { ok: c.ok, empty: !f.el.value.trim() };
      });
    };
    return {
      read: function () {
        var r = each();
        if (r.every(function (x) { return x.empty; })) return { empty: true };
        var right = r.filter(function (x) { return x.ok; }).length;
        return { ok: right === r.length, close: right > 0, credit: right / r.length, answer: fields.map(function (f) { return f.el.value.trim() || "—"; }).join(" | ") };
      },
      show: function (res, final) {
        var r = each();
        fields.forEach(function (f, i) {
          f.el.classList.remove("ok", "bad");
          f.el.classList.add(r[i].ok ? "ok" : "bad");
          if (final && !r[i].ok) f.el.value = String(f.cell.answer);
        });
      },
      reset: function () { fields.forEach(function (f) { f.el.value = ""; f.el.classList.remove("ok", "bad"); }); },
    };
  };
  ITEMS.plot = function (item, box, W) {
    // y = fn(x, params…) with a slider per parameter; graded: bring it onto the target (dashed), or explore (ungraded).
    var names = Object.keys(item.params || {});
    var fn = compile(item.fn, ["x"].concat(names));
    var vals = {};
    names.forEach(function (n) { var p = item.params[n]; vals[n] = p.value != null ? Number(p.value) : (Number(p.min) + Number(p.max)) / 2; });
    var svg = plot({ x: item.x, y: item.y });
    if (item.target) {
      var tv = {};
      names.forEach(function (n) { tv[n] = item.target[n] != null ? Number(item.target[n]) : vals[n]; });
      svg.curve(function (x) { tv.x = x; return fn(tv); }, { dashed: true, color: "var(--zk-muted,#888)", width: 2 });
    }
    var curve = svg.curve(function (x) { vals.x = x; return fn(vals); });
    box.appendChild(h("div", { cls: "zk-media" }, svg));
    var grid = h("div", { cls: "zk-param" });
    names.forEach(function (n) {
      var p = item.params[n];
      var out = h("span", { cls: "zk-val", text: String(vals[n]) });
      var r = h("input", { type: "range", cls: "zk-range", min: p.min, max: p.max, step: p.step || (p.max - p.min) / 100, value: vals[n], "aria-label": n });
      r.addEventListener("input", function () {
        if (box.locked) return;
        vals[n] = Number(r.value);
        out.textContent = String(Math.round(vals[n] * 1000) / 1000);
        curve.update(function (x) { vals.x = x; return fn(vals); });
      });
      grid.appendChild(h("b", { html: fmt("$" + n + "$") }));
      grid.appendChild(r);
      grid.appendChild(out);
    });
    box.appendChild(h("p", { cls: "zk-intro", text: item.target ? W.matchCurve : W.explore }));
    box.appendChild(grid);
    return {
      read: function () {
        var answer = names.map(function (n) { return n + " = " + Math.round(vals[n] * 1000) / 1000; }).join(", ");
        if (!item.target) return { ok: true, answer: answer, ungraded: true };
        var tol = item.tol != null ? Number(item.tol) : 0.05;
        var right = names.filter(function (n) { return item.target[n] == null || Math.abs(vals[n] - item.target[n]) <= tol * Math.max(1, Math.abs(item.target[n])); }).length;
        return { ok: right === names.length, close: right > 0, credit: right / names.length, answer: answer };
      },
      show: function () {},
      reset: function () {},
      answerText: item.target ? names.map(function (n) { return n + " = " + item.target[n]; }).join(", ") : "",
    };
  };
  ITEMS.scenario = function (item, box, W) {
    // A decision path: nodes { text, choices: [{ label, to, feedback? }] } — an end node { text, end: true, score: 0..1 }.
    var nodes = item.nodes;
    var path = [];
    var at = item.start || Object.keys(nodes)[0];
    var stage = h("div");
    var result = null;
    box.appendChild(stage);
    function draw() {
      stage.innerHTML = "";
      var n = nodes[at];
      if (!n) throw new Error("scenario: no node “" + at + "”");
      path.forEach(function (p) {
        stage.appendChild(h("div", { cls: "zk-intro", html: "➜ " + fmt(p.label) + (p.feedback ? " — <i>" + fmt(p.feedback) + "</i>" : "") }));
      });
      stage.appendChild(h("div", { cls: "zk-q zk-pop", html: fmt(n.text) }));
      if (n.end) {
        result = { ok: (n.score == null ? 1 : n.score) >= 0.999, close: n.score > 0, credit: n.score == null ? 1 : Number(n.score), answer: path.map(function (p) { return p.label; }).join(" → ") };
        if (box.autoCheck) box.autoCheck();
        return;
      }
      var list = h("div", { cls: "zk-opts" });
      (n.choices || []).forEach(function (c) {
        list.appendChild(
          h("button", {
            type: "button",
            cls: "zk-opt",
            html: "<span>" + fmt(c.label) + "</span>",
            onclick: function () {
              if (box.locked) return;
              path.push(c);
              at = c.to;
              draw();
            },
          }),
        );
      });
      stage.appendChild(list);
    }
    draw();
    return {
      instant: true,
      once: true,
      read: function () { return result || { empty: true }; },
      show: function () {},
      reset: function () { path = []; at = item.start || Object.keys(nodes)[0]; result = null; draw(); },
    };
  };
  ITEMS.cards = function (item, box, W) {
    // Self-check cards: flip, then say whether you knew it — the share you knew is the score.
    var i = 0;
    var knew = 0;
    var answers = [];
    var stage = h("div");
    box.appendChild(stage);
    var finished = false;
    function draw() {
      stage.innerHTML = "";
      if (i >= item.cards.length) { finished = true; if (box.autoCheck) box.autoCheck(); return; }
      var c = item.cards[i];
      var back = false;
      var card = h("div", { cls: "zk-card zk-pop", role: "button", tabindex: "0", html: fmt(c.front) });
      var row = h("div", { cls: "zk-row" });
      var flip = function () {
        back = !back;
        card.innerHTML = fmt(back ? c.back : c.front);
        row.hidden = !back;
      };
      card.onclick = flip;
      card.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } };
      row.hidden = true;
      row.appendChild(h("button", { type: "button", cls: "zk-btn pri", text: W.knew, onclick: function () { knew++; answers.push(true); i++; draw(); } }));
      row.appendChild(h("button", { type: "button", cls: "zk-btn", text: W.didnt, onclick: function () { answers.push(false); i++; draw(); } }));
      stage.appendChild(h("div", { cls: "zk-count", text: i + 1 + " / " + item.cards.length + " · " + W.flip }));
      stage.appendChild(card);
      stage.appendChild(row);
    }
    draw();
    return {
      instant: true,
      once: true,
      read: function () {
        if (!finished) return { empty: true };
        return { ok: knew === item.cards.length, close: knew > 0, credit: item.cards.length ? knew / item.cards.length : 1, answer: knew + "/" + item.cards.length };
      },
      show: function () {},
      reset: function () { i = 0; knew = 0; answers = []; finished = false; draw(); },
    };
  };

  // -------------------------------------------------------------------------------------------------------------------
  // The set: one item at a time, a progress bar, feedback, tries, the summary, the report
  // -------------------------------------------------------------------------------------------------------------------
  var styled = false;
  function mount(el, spec) {
    if (!doc) throw new Error("ZeffKit.mount needs a page");
    if (typeof el === "string") el = doc.querySelector(el);
    if (!styled) { doc.head.appendChild(h("style", { text: CSS })); styled = true; }
    var W = WORDS[langOf(spec)];
    var dark = doc.documentElement.style.colorScheme === "dark" || (getComputedStyle(doc.documentElement).colorScheme || "").indexOf("dark") >= 0;
    var root = h("div", { cls: "zk" + (dark ? " dark" : "") });
    el.innerHTML = "";
    el.appendChild(root);
    var all = (spec.items || []).map(function (it, i) { return Object.assign({ _i: i }, it); });
    var maxTries = spec.tries != null ? Math.max(1, Number(spec.tries)) : 2;
    var queue = all.slice();
    var results = {};
    var pos = 0;

    var head = h("div", { cls: "zk-head" }, h("div", { cls: "zk-title", html: fmt(spec.title || "") }), h("div", { cls: "zk-count" }));
    var bar = h("div", { cls: "zk-bar" }, h("i", { style: "width:0" }));
    var card = h("div");
    root.appendChild(head);
    if (spec.intro) root.appendChild(h("p", { cls: "zk-intro", html: fmt(spec.intro) }));
    root.appendChild(bar);
    root.appendChild(card);

    var progress = function () {
      head.lastChild.textContent = Math.min(pos + 1, queue.length) + " " + W.of + " " + queue.length;
      bar.firstChild.style.width = Math.round((pos / Math.max(1, queue.length)) * 100) + "%";
    };

    function showItem() {
      progress();
      card.innerHTML = "";
      if (pos >= queue.length) return summary();
      var item = queue[pos];
      var box = h("div", { cls: "zk-pop" });
      card.appendChild(box);
      var api;
      var tries = 0;
      try {
        if (item.q && item.type !== "cloze") box.appendChild(h("div", { cls: "zk-q", html: fmt(item.q) }));
        var m = item.type !== "hotspot" ? media(item.media) : null;
        if (m) box.appendChild(m);
        var make = ITEMS[item.type];
        if (!make) throw new Error("unknown type “" + item.type + "”");
        api = make(item, box, W);
      } catch (e) {
        report_error(e, item);
        box.innerHTML = "";
        box.appendChild(h("div", { cls: "zk-broken", text: W.broken }));
        box.appendChild(h("div", { cls: "zk-row" }, h("button", { type: "button", cls: "zk-btn pri", text: W.next, onclick: function () { results[item._i] = { item: item, skipped: true }; pos++; showItem(); } })));
        return;
      }
      var fb = h("div", { "aria-live": "polite" });
      var hintBox = null;
      var row = h("div", { cls: "zk-row" });
      var checkBtn = h("button", { type: "button", cls: "zk-btn pri", text: api.instant ? W.finish : W.check });
      var hintBtn = item.hint ? h("button", { type: "button", cls: "zk-btn", text: "💡 " + W.hint }) : null;
      var nextBtn = h("button", { type: "button", cls: "zk-btn pri", text: pos + 1 >= queue.length ? W.finish : W.next, hidden: true });
      if (!api.instant || item.type === "choice") row.appendChild(checkBtn);
      if (api.instant && item.type === "choice") checkBtn.hidden = true;
      if (hintBtn) row.appendChild(hintBtn);
      row.appendChild(nextBtn);
      box.appendChild(fb);
      box.appendChild(row);
      if (hintBtn)
        hintBtn.onclick = function () {
          if (!hintBox) { hintBox = h("div", { cls: "zk-hint", html: "💡 " + fmt(item.hint) }); box.insertBefore(hintBox, fb); }
          hintBtn.disabled = true;
        };
      var settle = function (r) {
        if (r.empty) {
          fb.className = "zk-fb warn";
          fb.innerHTML = W.empty;
          return;
        }
        tries++;
        var final = r.ok || r.ungraded || tries >= maxTries || api.once;
        try { api.show(r, final); } catch (e) { report_error(e, item); }
        var credit = r.ok ? (tries === 1 ? 1 : 0.5) : final ? (r.credit != null ? r.credit * 0.5 : 0) : 0;
        if (r.ungraded) credit = 1;
        if (r.ok && r.credit != null && tries === 1) credit = 1;
        if (final) {
          results[item._i] = { item: item, ok: !!r.ok, credit: Math.max(0, Math.min(1, credit)), answer: r.answer, ungraded: !!r.ungraded };
          box.locked = true;
          checkBtn.hidden = true;
          if (hintBtn) hintBtn.hidden = true;
          nextBtn.hidden = false;
          setTimeout(function () { try { nextBtn.focus({ preventScroll: true }); } catch (e) {} }, 30);
        }
        var title = r.ok ? W.right + (r.typo ? " (≈)" : "") : r.ungraded ? "✓" : final ? W.wrong : (r.close ? W.almost : "") + W.tryAgain;
        var parts = ['<b class="t">' + (r.ok ? "✅ " : final ? "❌ " : "↻ ") + esc(title) + "</b>"];
        if (r.note === "unitMissing" || r.unitWrong) parts.push(esc(W.unitMissing) + (item.unit ? " (" + esc(item.unit) + ")" : ""));
        if (r.error) parts.push(esc(W.parseError + r.error));
        if (r.missing && r.missing.length && final) parts.push("— " + esc(r.missing.join(", ")));
        if (r.why) parts.push(fmt(r.why));
        if (final && !r.ok && !r.ungraded) {
          var at = api.answerText != null ? api.answerText : answerText(item);
          if (at) parts.push(esc(W.answerWas) + fmt(at));
        }
        if (final && item.explain) parts.push(fmt(item.explain));
        fb.className = "zk-fb " + (r.ok || r.ungraded ? "ok" : final ? "bad" : "warn");
        fb.innerHTML = parts.join("<br>");
        if (!final) {
          checkBtn.textContent = W.check;
          if (api.reset && (item.type === "choice" || api.once)) {
            /* a choice is re-picked by hand */
          }
          if (hintBtn && !hintBox) hintBtn.classList.add("pri");
        }
      };
      var check = function () {
        if (box.locked || box.checking) return;
        var r;
        try {
          r = api.read();
        } catch (e) {
          report_error(e, item);
          r = { ok: false, error: e.message };
        }
        if (r && typeof r.then === "function") {
          box.checking = true;
          checkBtn.disabled = true;
          checkBtn.textContent = W.running;
          r.then(
            function (x) { box.checking = false; checkBtn.disabled = false; checkBtn.textContent = W.check; settle(x); },
            function (e) { box.checking = false; checkBtn.disabled = false; checkBtn.textContent = W.check; report_error(e, item); settle({ ok: false, error: String(e && e.message) }); },
          );
        } else settle(r);
      };
      box.submit = check;
      box.autoCheck = check;
      checkBtn.onclick = check;
      if (item.type === "code") checkBtn.textContent = "▶ " + W.run;
      nextBtn.onclick = function () { pos++; showItem(); };
      if (api.focus && pos > 0) setTimeout(function () { try { api.focus.focus({ preventScroll: true }); } catch (e) {} }, 30);
    }

    function summary() {
      bar.firstChild.style.width = "100%";
      var done = Object.keys(results).map(function (k) { return results[k]; });
      var graded = done.filter(function (r) { return !r.skipped && !r.ungraded; });
      var weight = function (r) { return r.item.points != null ? Number(r.item.points) : 1; };
      var total = graded.reduce(function (a, r) { return a + weight(r); }, 0);
      var got = graded.reduce(function (a, r) { return a + weight(r) * r.credit; }, 0);
      var score = total ? got / total : 1;
      var right = graded.filter(function (r) { return r.ok; }).length;
      var wrong = done.filter(function (r) { return !r.skipped && !r.ok && !r.ungraded; });
      head.lastChild.textContent = "";
      var list = h("ul", { cls: "zk-sumlist" });
      done
        .sort(function (a, b) { return a.item._i - b.item._i; })
        .forEach(function (r) {
          list.appendChild(h("li", { html: (r.skipped ? "⚠️ " : r.ungraded ? "• " : r.ok ? "✅ " : "❌ ") + fmt(plain(titleOf(r.item) || W.item)) + (r.answer ? ' <span style="color:var(--zk-muted)">— ' + esc(r.answer) + "</span>" : "") }));
        });
      var again = h("div", { cls: "zk-row", style: "justify-content:center" });
      if (wrong.length)
        again.appendChild(
          h("button", { type: "button", cls: "zk-btn pri", text: W.retryWrong + " (" + wrong.length + ")", onclick: function () { queue = wrong.map(function (r) { return r.item; }); pos = 0; showItem(); } }),
        );
      again.appendChild(h("button", { type: "button", cls: "zk-btn", text: W.restart, onclick: function () { queue = all.slice(); results = {}; pos = 0; showItem(); } }));
      card.innerHTML = "";
      card.appendChild(
        h("div", { cls: "zk-sum zk-pop" }, h("div", { cls: "zk-big", text: Math.round(score * 100) + " %" }), h("div", { text: (score >= (spec.pass != null ? spec.pass : 0.8) ? "🎉 " : "") + W.done + " " + right + " " + W.of + " " + graded.length }), list, again),
      );
      var answers = done.map(function (r) {
        var a = { q: plain(titleOf(r.item) || W.item + " " + (r.item._i + 1)), a: r.skipped ? "(skipped: broken)" : String(r.answer == null ? "" : r.answer).slice(0, 280) };
        if (!r.skipped && !r.ungraded) a.ok = r.ok;
        return a;
      });
      if (typeof zeff !== "undefined" && zeff.report) zeff.report({ score: score, correct: right, total: graded.length, answers: answers, done: true, note: spec.title ? plain(spec.title) : undefined }); // eslint-disable-line no-undef
      if (typeof spec.onDone === "function") spec.onDone({ score: score, answers: answers });
    }

    function report_error(e, item) {
      var msg = (item ? "item " + (item._i + 1) + " (" + item.type + "): " : "") + String((e && e.message) || e);
      if (typeof zeff !== "undefined" && zeff.error) zeff.error(msg); // eslint-disable-line no-undef
      else if (typeof console !== "undefined") console.error(msg);
    }

    if (!all.length) {
      card.appendChild(h("div", { cls: "zk-broken", text: W.broken }));
      report_error(new Error("the set has no items"));
      return;
    }
    showItem();
  }

  return {
    mount: mount,
    fmt: fmt,
    plot: plot,
    expr: compile,
    check: { number: checkNumber, text: checkText, formula: checkFormula, parseNumber: parseNumber, parseCloze: parseCloze },
    runCode: runCode,
    TYPES: Object.keys(ITEMS),
  };
});
