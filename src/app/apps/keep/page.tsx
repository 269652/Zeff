import { redirect } from "next/navigation";

/** The Keep app moved to /keep (its own tab with your boards). */
export default function OldKeepPage() {
  redirect("/keep");
}
