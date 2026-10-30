import { moved } from "@/lib/moved";

/** The browser sign-ins are a part of Connections now (/settings/connections#sign-ins) — the setup's ?setup=1 too. */
export default async function LoginsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return moved("/settings/connections", searchParams, "sign-ins");
}
