import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { reviewItems } from "@/lib/review";
import { ReviewList } from "./ReviewList";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Review") };
}

/**
 * The review queue: everything Zeff wants you to confirm, from every installed plugin, in one list — a name that
 * may be someone's, what the AI read, a todo it thinks is done, actions it proposes. Answered with a click or a key.
 */
export default async function ReviewPage() {
  await connection();
  const q = await reviewItems();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Review")}</h1>
        <p className="text-sm text-zinc-500">{t("Everything waiting for your yes or no, from all plugins. Keys: j/k or ↓/↑ to move, y yes, n no, e or Enter opens it.")}</p>
      </div>
      <ReviewList items={q.items} links={q.links} errors={q.errors} />
    </div>
  );
}
