import { currentAccount } from "@/db/accounts";
import { apiPoint } from "./api-point";
import { API_VERSION } from "@/lib/ext/manifest";
import { storageDelete, storageGet, storageKeys, storageSet } from "@/lib/ext/storage";
import { t } from "@/lib/i18n/server";

/** What Zeff itself brings to the API: who you are talking to, and the plugin's own small store. Always there. */
apiPoint.contribute("core", {
  permissions: () => ({
    prompt: t("Add rules to what Code's workers are told"),
    exec: t("Run programs on this computer (event hooks, MCP servers) — with your rights"),
    network: t("Let its panels contact other websites (otherwise they can't)"),
    browser: t("Open public web pages in an automated Chrome on this computer — it can click and type there (no logins, never your own network)"),
  }),
  methods: {
    hello: {
      summary: "The API version, who you are talking to, the permissions held and held back.",
      run: async (_p, caller) => {
        // Loaded here: the registry loads this file (to know the permissions), so it can't be imported at the top.
        const ext = caller.source === "external" ? (await import("@/lib/ext/registry")).getPlugin(caller.plugin) : undefined;
        return {
          apiVersion: API_VERSION,
          plugin: { id: caller.plugin, name: ext?.manifest.name ?? caller.plugin, version: ext?.manifest.version ?? "builtin" },
          account: { id: currentAccount().id, name: currentAccount().name },
          permissions: [...caller.permissions],
          ungranted: [...caller.ungranted],
        };
      },
    },
    "storage.get": { summary: "A value from the plugin's own store (null if none).", run: (p, c) => storageGet(c.plugin, p.key) },
    "storage.set": { summary: "Keep a value in the plugin's own store.", run: (p, c) => (storageSet(c.plugin, p.key, p.value), true) },
    "storage.delete": { summary: "Delete a key.", run: (p, c) => (storageDelete(c.plugin, p.key), true) },
    "storage.keys": { summary: "The keys in the store.", run: (_p, c) => storageKeys(c.plugin) },
  },
});
