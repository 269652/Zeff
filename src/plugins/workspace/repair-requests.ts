/**
 * What the Workspace assistant is asked when "Repair with the AI" is clicked for a flow, a plugin's function or an installed app
 * (ui/repair-button.tsx): what is wrong, the tools to read, try and save it, the versions to go back to. Plain text, used on the server
 * and in the browser.
 */

/** What the assistant is asked for a flow that failed (its name, the error, the run). */
export const flowRepairRequest = (name: string, error: string, runId?: number) =>
  `The flow “${name}” failed${runId ? ` (run ${runId})` : ""}: ${error.slice(0, 1500)}

Find out why and repair it: workspace_read_flow reads it, workspace_flow_runs shows its runs with every step's log, workspace_flow_docs the language. Save the repaired flow with workspace_save_flow and try it with workspace_run_flow (dry: true first). If a recent change broke it, workspace_part_versions (kind flow, ref = its page id) lists the versions before and workspace_restore_part brings one back. A plugin function it calls may be the cause: workspace_function_source / workspace_save_function. Keep what the flow does; say in two sentences what was wrong and what you changed.`;

/** What the assistant is asked for a plugin's function. */
export const functionRepairRequest = (plugin: string, name: string) =>
  `Check the function “${plugin}.${name}” and repair it if something is wrong: workspace_function_source reads its code and its versions, workspace_call_function tries it (with arguments that make sense for it), workspace_flow_runs shows the flows that called it and failed. Save a fix with workspace_save_function; if a recent change broke it, workspace_restore_function brings an earlier version back. Keep what it does; say in two sentences what was wrong and what you changed (or that it works).`;

/** What the assistant is asked for an installed app (package). */
export const packageRepairRequest = (id: string, name: string, rootId: number) =>
  `Check the app “${name}” (package ${id}, its page ${rootId}) and repair what is broken: workspace_package_test runs its own tests, workspace_database_schema shows its databases and views — a view whose template has mistakes: workspace_view_template_docs, workspace_update_database update_view (workspace_view_versions / workspace_restore_view to go back); its flows: workspace_flows, workspace_flow_runs (failed runs), workspace_read_flow / workspace_save_flow; the plugin functions they call: workspace_function_source / workspace_save_function. Do not delete entries; do not reinstall it. Say in a few sentences what was wrong and what you changed (or that all is well).`;
