/**
 * The knowledge server reads Confluence by itself — a few minutes after it starts, then every
 * KNOWLEDGE_EVERY_HOURS hours (default 1) — and compiles what changed. KNOWLEDGE_SCHEDULE=off: only by hand.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.KNOWLEDGE_SCHEDULE === "off") return;
  const { syncPages } = await import("./lib/ingest");
  const { compilePages } = await import("./lib/compile");
  const { confluenceConfig } = await import("./lib/confluence");
  const { getSettings } = await import("./lib/db");
  const { kInstalled } = await import("./lib/plugins");
  // Hourly: Zeff's data (messages, todos, facts) changes all day; only what changed is compiled.
  const every = (Number(process.env.KNOWLEDGE_EVERY_HOURS) || 1) * 3600000;
  const turn = async () => {
    try {
      // Only with the plugin "Automatisch lesen" — and a source to read.
      if (kInstalled("auto-refresh") && ((kInstalled("confluence") && confluenceConfig()) || kInstalled("zeff") || kInstalled("google-keep") || (kInstalled("import-folder") && getSettings().importDir))) {
        const r = await syncPages();
        if (r.ok) await compilePages();
        else console.warn(`[knowledge] ${r.message}`);
      }
    } catch (e) {
      console.error("[knowledge]", e);
    }
    setTimeout(turn, every).unref();
  };
  setTimeout(turn, 5 * 60000).unref();
}
