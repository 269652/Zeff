import { AgentInstructionsProvider } from "@/components/AgentInstructions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { HashHighlight } from "@/components/HashHighlight";
import { AttentionBar } from "@/components/AttentionBar";
import { listAttention } from "@/lib/attention";
import { activityNewsIds } from "@/lib/boards/activity";
import { getWorkSettings } from "@/lib/work/store";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { Toaster } from "@/components/Toaster";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Zeff", template: "%s · Zeff" },
  description: "Zeff — hourly time reports for jobs, with an MCP server for agents.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader activityIds={activityNewsIds()} />
        <AttentionBar items={await listAttention()} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          <AgentInstructionsProvider templates={getWorkSettings().agentInstructions}>{children}</AgentInstructionsProvider>
        </main>
        <LiveRefresh />
        <HashHighlight />
        <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-zinc-400">
          Zeff · time entries are stored in a local SQLite database · MCP endpoint at{" "}
          <code className="code">/api/mcp</code>
        </footer>
        <Toaster />
      </body>
    </html>
  );
}
