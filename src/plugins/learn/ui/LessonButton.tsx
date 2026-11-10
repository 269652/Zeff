"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { startLessonAction } from "@/app/learn/actions";

/** Into a step's lesson (its chat with the teacher — made the first time). */
export function LessonButton({ courseId, stepKey, label, primary = true, className = "", stay = false }: { courseId: number; stepKey: string; label?: string; primary?: boolean; className?: string; /** Shown where the lesson is (its row in the Workspace): stay, and read the page again. */ stay?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn ${primary ? "btn-primary" : ""} ${className}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await startLessonAction(courseId, stepKey);
          if (!r.ok) return void toast(r.error, { tone: "error" });
          if (stay) router.refresh();
          else router.push(`/learn/${courseId}/step/${encodeURIComponent(stepKey)}`);
        })
      }
    >
      {pending ? t("Starting …") : (label ?? t("Start the lesson"))}
    </button>
  );
}
