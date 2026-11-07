/**
 * The Workspace plugin's server actions: what its pages and editors call. Each says what came of it; none throws at the page.
 * They live in actions/ by domain (each file "use server"); this file only re-exports them: a "use server" file may export
 * nothing but its own async functions, so it has no directive of its own.
 */
export type { Result } from "./actions/shared";
export * from "./actions/pages";
export * from "./actions/mentions";
export * from "./actions/databases";
export * from "./actions/pipeline";
export * from "./actions/rows";
export * from "./actions/lookups";
export * from "./actions/dossier";
export * from "./actions/todos";
export * from "./actions/ai";
export * from "./actions/routines";
export * from "./actions/widgets";
export * from "./actions/forms";
export * from "./actions/details";
export * from "./actions/formulas";


