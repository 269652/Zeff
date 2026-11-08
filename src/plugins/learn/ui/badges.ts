import type { BadgeId } from "../game";

type T = (s: string, v?: Record<string, string | number>) => string;

/** A badge's icon and name (literal t calls, so the language bundles have them). */
export function badgeLabel(t: T, id: BadgeId): { icon: string; name: string } {
  switch (id) {
    case "first-step":
      return { icon: "👣", name: t("First step") };
    case "first-skill":
      return { icon: "🧩", name: t("First skill") };
    case "first-phase":
      return { icon: "🏔️", name: t("First phase") };
    case "first-year":
      return { icon: "🎓", name: t("First year") };
    case "streak-7":
      return { icon: "🔥", name: t("7 days in a row") };
    case "streak-30":
      return { icon: "🌋", name: t("30 days in a row") };
    case "reviews-100":
      return { icon: "🃏", name: t("100 reviews") };
    case "reviews-1000":
      return { icon: "🏛️", name: t("1000 reviews") };
    case "widgets-10":
      return { icon: "🧪", name: t("10 exercises") };
    case "course-done":
      return { icon: "🏆", name: t("Course complete") };
  }
}
