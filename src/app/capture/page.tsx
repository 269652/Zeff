import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { CapturePage } from "@/plugins/workspace/ui/CapturePage";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Quick capture") };
}

/** Quick capture, made for the phone: a note and/or a photo, one tap - kept on the device and sent later when there is no connection. */
export default async function Capture() {
  await connection();
  return (
    <div className="page">
      <CapturePage />
    </div>
  );
}
