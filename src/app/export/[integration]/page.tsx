import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { integrationServer } from "@/lib/integrations/server";

/**
 * /export/<plugin>: the export page of a plugin of a mounted integration (/export/chrono, /export/punch) —
 * the page itself lives in the integration's repository (src/lib/integrations). Not there: not found.
 */
const pageOf = async (params: Promise<{ integration: string }>) => integrationServer((await params).integration)?.pages?.export;

export async function generateMetadata({ params }: { params: Promise<{ integration: string }> }): Promise<Metadata> {
  return (await (await pageOf(params))?.generateMetadata?.()) ?? {};
}

export default async function IntegrationExportPage({ params, searchParams }: { params: Promise<{ integration: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await pageOf(params);
  if (!page) notFound();
  return page.default({ searchParams });
}
