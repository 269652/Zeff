import { builtinLambdasPoint } from "@/plugins/workspace/lambdas/store";

/**
 * What Lookups registers (loaded through plugins/contributions): its sources, each a lambda in lambdas/ — TMDB's films and series,
 * Wikipedia, Open Library, Google Books and Knowledge Graph, the web search. The Workspace lists them as lookup sources; the Studio
 * shows their code, and a change of one is kept beside Zeff's.
 */
builtinLambdasPoint.contribute("lookups", { dir: "src/plugins/lookups/lambdas" });
