/**
 * What the Workspace assistant is asked about a mod (plain text, used in the browser): a mod whose hooks are held back because an update
 * of Zeff changed the code it was written for — adapted with one click on the Mods page, and you switch it on again.
 */

/** Adapt a mod to the code Zeff has now. */
export const modAdaptRequest = (id: string, name: string, hooks: string[]) =>
  `The mod “${name}” (${id}) is held back: Zeff changed the code it was written for, or it is gone — ${hooks.join(", ")}.

Adapt it so it does the same as before on the code Zeff has now: workspace_mod_read reads the mod; workspace_mod_hooks with id and code: true shows each hook's code as it is now (a hook that is gone: find where that code went with workspace_mod_hooks and a query). Change only what the new code needs, keep what the mod does, and save it with workspace_mod_save (it is built at once; fix what doesn't build). Say in two sentences what changed in Zeff and what you changed in the mod — the user switches it on again.`;
