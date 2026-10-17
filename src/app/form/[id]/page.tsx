import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { formFor } from "@/plugins/workspace/form";
import { FormPage } from "@/plugins/workspace/ui/FormPage";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const form = formFor(Number((await params).id));
  return { title: form?.spec.title || form?.database || t("Form") };
}

/** A database's form (set up in its menu → Form): ask the fields, make a row. Not there when the form is switched off. */
export default async function Form({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const form = formFor(Number((await params).id));
  if (!form) notFound();
  return (
    <div className="page">
      <FormPage form={form} />
    </div>
  );
}
