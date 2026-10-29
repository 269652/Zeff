import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { getPage } from "@/plugins/workspace/store";
import { formAt } from "@/plugins/workspace/forms";
import { FormRunner } from "@/plugins/workspace/ui/form-runner";

/** The form at this address — a form page, or (an old link to a database's form) the form page it became; none in the trash. */
function formOf(id: number) {
  if (!isInstalled("workspace") || !Number.isInteger(id)) return null;
  const form = formAt(id);
  return form && !getPage(form.id)?.archivedAt ? form : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const form = formOf(Number((await params).id));
  return { title: form?.def.title || form?.title || t("Form") };
}

/** A form on its own (the link a form page hands out): filled in, it makes a row of its database. Behind the lock like every page. */
export default async function Form({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const form = formOf(Number((await params).id));
  if (!form) notFound();
  return (
    <div className="page">
      <div className="mx-auto max-w-2xl py-6">
        <FormRunner form={form} />
      </div>
    </div>
  );
}
