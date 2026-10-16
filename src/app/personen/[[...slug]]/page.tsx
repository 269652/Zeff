import { redirect } from "next/navigation";
import { connection } from "next/server";
import { peopleHome, personHref } from "@/plugins/workspace/people-database";

/**
 * The old People pages are gone — the people are a database of the Workspace now. A link to /personen/<id> (an old bookmark or
 * notification) goes to the person's page there; /personen and the rest to the database.
 */
export default async function OldPeopleLink({ params }: { params: Promise<{ slug?: string[] }> }) {
  await connection();
  const id = Number((await params).slug?.[0]);
  redirect(Number.isInteger(id) && id > 0 ? personHref(id) : peopleHome());
}
