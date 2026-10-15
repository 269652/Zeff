"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { addArtifact, deleteArtifact } from "@/lib/work/branch-knowledge";

/** The branch knowledge (Prompts → Branch names): one added by hand or deleted — forms post to these. */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (error?: string): never => redirect(`/settings/prompts${error ? `?error=${encodeURIComponent(error)}` : ""}#branchname`);

export async function addArtifactAction(fd: FormData): Promise<void> {
  let err: string | undefined;
  try {
    const ticket = str(fd, "ticket");
    if (!/^[A-Za-z][A-Za-z0-9]+-\d+$/.test(ticket)) throw new Error("A ticket key like PROJ-306, please.");
    addArtifact({ ticket, kind: str(fd, "kind") === "rule" ? "rule" : "change", text: str(fd, "text"), ref: str(fd, "ref") || null });
  } catch (e) {
    err = errorMessage(e);
  }
  revalidatePath("/settings/prompts");
  back(err);
}

export async function deleteArtifactAction(fd: FormData): Promise<void> {
  deleteArtifact(Number(str(fd, "id")));
  revalidatePath("/settings/prompts");
  back();
}
