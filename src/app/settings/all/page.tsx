import { redirect } from "next/navigation";

/** The settings hub is /settings now. */
export default function AllSettingsPage() {
  redirect("/settings");
}
