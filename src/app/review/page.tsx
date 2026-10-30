import { redirect } from "next/navigation";

/** The review queue is a part of Today now: the old address leads there. */
export default function ReviewPage() {
  redirect("/heute#review");
}
