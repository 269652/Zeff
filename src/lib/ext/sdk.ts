/**
 * What a panel loads from Zeff: /ext/sdk/zeff.js (window.zeff — the API as promises) and
 * /ext/sdk/zeff.css (Zeff's colours and a few controls, light and dark). Plain ES5-style scripts
 * as strings, so there is nothing to build and the packaged app has them. docs/plugins/panels.md
 * documents them; keep both in step.
 *
 * A panel runs in a sandboxed frame without its own origin, so it can't call Zeff's API itself.
 * zeff.call() posts a message to the page around the frame, which makes the request for it (and
 * checks the plugin's permissions on the server) — see src/components/ext/ExtFrame.tsx.
 */

export const SDK_JS = `/* Zeff extension SDK, API version 1 — docs/plugins/panels.md */
(function () {
  "use strict";
  var pending = {};
  var handlers = {};
  var nextId = 0;

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++nextId;
      var timer = setTimeout(function () {
        delete pending[id];
        reject(fail("timeout", method + " didn't answer in time"));
      }, 120000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      parent.postMessage({ zeffExt: 1, id: id, method: method, params: params || {} }, "*");
    });
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== parent) return;
    var m = ev.data;
    if (!m || m.zeffExt !== 1) return;
    if (m.id && pending[m.id]) {
      var p = pending[m.id];
      delete pending[m.id];
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(fail((m.error && m.error.code) || "failed", (m.error && m.error.message) || "failed"));
    } else if (m.event) {
      (handlers[m.event] || []).slice().forEach(function (fn) {
        try {
          fn(m.data);
        } catch (e) {
          console.error(e);
        }
      });
    }
  });

  var zeff = {
    version: 1,
    /** Any API method by name: zeff.call("work.runs.list", { limit: 5 }). */
    call: call,
    /** Listen: "change" ({ topic: "work" | "todos" | "attention" | "kanban" }). Returns how to stop. */
    on: function (event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
      return function () {
        zeff.off(event, fn);
      };
    },
    off: function (event, fn) {
      handlers[event] = (handlers[event] || []).filter(function (f) {
        return f !== fn;
      });
    },
    /** Resolves with { apiVersion, plugin, account, permissions, context } once the page around the frame is ready. */
    ready: null,
    info: null,
    storage: {
      get: function (key) {
        return call("storage.get", { key: key });
      },
      set: function (key, value) {
        return call("storage.set", { key: key, value: value });
      },
      delete: function (key) {
        return call("storage.delete", { key: key });
      },
      keys: function () {
        return call("storage.keys");
      },
    },
    work: {
      runs: {
        list: function (params) {
          return call("work.runs.list", params);
        },
        get: function (id) {
          return call("work.runs.get", { id: id });
        },
        log: function (id, from) {
          return call("work.runs.log", { id: id, from: from || 0 });
        },
        cancel: function (id) {
          return call("work.runs.cancel", { id: id });
        },
      },
      sessions: {
        start: function (params) {
          return call("work.sessions.start", params);
        },
        send: function (runId, message) {
          return call("work.sessions.send", { runId: runId, message: message });
        },
      },
    },
    todos: {
      list: function (params) {
        return call("todos.list", params);
      },
      add: function (params) {
        return call("todos.add", params);
      },
    },
    ui: {
      toast: function (message, tone) {
        return call("ui.toast", { message: message, tone: tone || "info" });
      },
      /** Go to a page of Zeff (a path like "/work?run=3"). */
      navigate: function (href) {
        return call("ui.navigate", { href: href });
      },
      openSession: function (runId) {
        return call("ui.navigate", { href: "/work?run=" + encodeURIComponent(runId) });
      },
      /** A session panel's height in pixels (tab panels fill the page). */
      resize: function (height) {
        return call("ui.resize", { height: height });
      },
    },
  };
  zeff.ready = call("hello").then(function (info) {
    zeff.info = info;
    return info;
  });
  window.zeff = zeff;
})();
`;

export const SDK_CSS = `/* Zeff extension SDK — Zeff's colours and a few controls (docs/plugins/panels.md). Light and dark follow the system, like Zeff. */
:root {
  --zeff-bg: #fafafa;
  --zeff-fg: #18181b;
  --zeff-muted: #71717a;
  --zeff-card: #ffffff;
  --zeff-line: #e4e4e7;
  --zeff-accent: #4f46e5;
  --zeff-accent-fg: #ffffff;
  --zeff-ok: #059669;
  --zeff-warn: #d97706;
  --zeff-bad: #dc2626;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --zeff-bg: #09090b;
    --zeff-fg: #e4e4e7;
    --zeff-muted: #a1a1aa;
    --zeff-card: #18181b;
    --zeff-line: #3f3f46;
    --zeff-accent: #818cf8;
    --zeff-accent-fg: #09090b;
    --zeff-ok: #34d399;
    --zeff-warn: #fbbf24;
    --zeff-bad: #f87171;
  }
}
html, body { margin: 0; background: var(--zeff-bg); color: var(--zeff-fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
body { padding: 16px; }
h1, h2, h3 { margin: 0 0 8px; font-weight: 600; }
h1 { font-size: 18px; } h2 { font-size: 15px; } h3 { font-size: 13px; color: var(--zeff-muted); text-transform: uppercase; letter-spacing: .04em; }
a { color: var(--zeff-accent); }
code, pre { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 12px; }
.muted { color: var(--zeff-muted); }
.card { background: var(--zeff-card); border: 1px solid var(--zeff-line); border-radius: 10px; padding: 12px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.btn { font: inherit; border: 1px solid var(--zeff-line); background: var(--zeff-card); color: inherit; border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.btn:hover { border-color: var(--zeff-accent); }
.btn:disabled { opacity: .5; cursor: default; }
.btn-primary { background: var(--zeff-accent); color: var(--zeff-accent-fg); border-color: var(--zeff-accent); }
.input { font: inherit; border: 1px solid var(--zeff-line); background: var(--zeff-card); color: inherit; border-radius: 8px; padding: 5px 10px; min-width: 0; }
.input:focus, .btn:focus-visible { outline: 2px solid var(--zeff-accent); outline-offset: 1px; }
.badge { display: inline-block; border-radius: 999px; padding: 0 8px; font-size: 11px; border: 1px solid var(--zeff-line); }
.ok { color: var(--zeff-ok); } .warn { color: var(--zeff-warn); } .bad { color: var(--zeff-bad); }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--zeff-line); } th { color: var(--zeff-muted); font-weight: 500; }
`;
