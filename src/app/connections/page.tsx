import { redirect } from "next/navigation";

/** Connections moved under Settings: old links and bookmarks (and sign-ins on their way back) land there. */
export default async function ConnectionsMoved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  redirect(`/settings/connections${q.size ? `?${q}` : ""}`);
}
