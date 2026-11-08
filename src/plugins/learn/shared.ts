/**
 * The learning platform's shapes (client-safe). A course is a topic you want to learn (differential geometry, French …):
 * a researched plan of years → phases → skills → steps, a skill tree over it (what a node requires), your progress
 * through it, the teacher's lessons (a live Claude session per node, with interactive widgets), and the cards you
 * review in good time (spaced repetition — reviews due become a todo).
 */

/** The plan's levels, coarse to fine. A step is the stone you master; the others are mastered when their parts are. */
export const NODE_KINDS = ["year", "phase", "skill", "step"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Where a node stands. locked: what it requires isn't mastered yet. */
export type NodeStatus = "locked" | "available" | "active" | "mastered";

/** A source the research found (a paper, a book, a course, a website). */
export type PlanSource = { id: string; title: string; authors?: string; year?: number; url?: string; kind?: "paper" | "book" | "course" | "web" | "other" };

/** A node of the plan as the research writes it: keys are its own (y1, y1.p2, y1.p2.s3 …). */
export type PlanNode = {
  key: string;
  kind: NodeKind;
  /** The node it belongs to (a step's skill, a skill's phase …); none for a year. */
  parent: string | null;
  title: string;
  summary?: string;
  /** What you can do once it's mastered ("compute the Gaussian curvature of a surface of revolution"). */
  objectives?: string[];
  /** Keys of nodes that must be mastered first (beside the parent's own requirements). */
  requires?: string[];
  /** A path through the tree (a direction of interest: "Riemannian geometry", "conversation", "grammar"). */
  path?: string;
  /** Experience for mastering it (defaults by kind). */
  xp?: number;
  /** About how long it takes, minutes. */
  minutes?: number;
  /** Ids of the plan's sources that cover it. */
  sources?: string[];
};

/** A researched plan, as the research step answers it. */
export type Plan = {
  title: string;
  summary: string;
  /** How long the whole plan takes at a steady pace, years. */
  years: number;
  sources: PlanSource[];
  nodes: PlanNode[];
};

/** Experience a node gives by default, by kind. */
export const DEFAULT_XP: Record<NodeKind, number> = { year: 500, phase: 150, skill: 50, step: 10 };
