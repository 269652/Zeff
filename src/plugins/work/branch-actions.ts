"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { addBranchRule, deleteBranchRule, setBranchRuleEnabled } from "@/lib/work/branch-rules";

/** The branch naming rules (Auswerten → Branch names): one kept, switched off or on, deleted — forms post to these. */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (error?: string): never => redirect(`/settings/prompts${error ? `?error=${encodeURIComponent(error)}` : ""}#branchname`);

export async function addBranchRuleAction(fd: FormData): Promise<void> {
  let err: string | undefined;
  try {
    addBranchRule({ text: str(fd, "text"), scope: str(fd, "scope"), refs: str(fd, "refs").split(/[\s,;]+/).filter(Boolean) });
  } catch (e) {
    err = errorMessage(e);
  }
  revalidatePath("/settings/prompts");
  back(err);
}

export async function toggleBranchRuleAction(fd: FormData): Promise<void> {
  setBranchRuleEnabled(Number(str(fd, "id")), str(fd, "enabled") === "1");
  revalidatePath("/settings/prompts");
  back();
}

export async function deleteBranchRuleAction(fd: FormData): Promise<void> {
  deleteBranchRule(Number(str(fd, "id")));
  revalidatePath("/settings/prompts");
  back();
}
