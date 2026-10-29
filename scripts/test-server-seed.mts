/**
 * A test server's fresh database made usable (scripts/test-server.mjs runs this before the server starts, with
 * DATABASE_PATH set to the throwaway database): migrated (on first use), the setup assistant done, and the plugins the UI
 * tests need installed (Workspace is by default; People is not). The app's own functions — what the setup and the Plugins
 * page do.
 */
if (!process.env.DATABASE_PATH || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");

const { updateAppSettings } = await import("@/lib/ai");
const { setInstalled } = await import("@/plugins/state");

updateAppSettings({ setupDoneAt: new Date().toISOString() });
for (const id of ["workspace", "people"] as const) setInstalled(id, true);
console.log("seeded: setup done, Workspace + People installed");
