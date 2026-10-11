import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { entityDetail, graphData } from "@k/graph";
import { GraphView, type CompactGraph } from "./GraphView";

export const metadata: Metadata = { title: "Graph" };

/**
 * The knowledge graph: every entity compiling found (people, systems, terms, documents …) and how
 * they're related — drawn whole, to look around in, filter, search; one entity opened shows what
 * it is, its relations and the pages behind them. ?e=<id> opens one.
 */
export default async function GraphPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  await connection();
  const { e } = await searchParams;
  const g = graphData();
  const data: CompactGraph = { nodes: g.nodes.map((n) => [n.id, n.name, n.type, n.pages, n.degree]), links: g.links.map((l) => [l.s, l.t, l.rel, l.n]) };
  const initial = e && Number.isInteger(Number(e)) && g.nodes.some((n) => n.id === Number(e)) ? Number(e) : null;

  async function load(id: number) {
    "use server";
    return entityDetail(Number(id));
  }

  if (!g.nodes.length)
    return (
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Graph</h1>
        <p className="text-sm text-zinc-500">
          No entities yet — compiling the pages makes them (
          <Link href="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Overview
          </Link>
          ).
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Graph</h1>
      <GraphView data={data} initial={initial} initialDetail={initial === null ? null : entityDetail(initial)} load={load} />
    </div>
  );
}
