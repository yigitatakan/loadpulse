import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { DraftshipRoot } from "@/lib/draftship-ui";

export const metadata: Metadata = {
  title: {
    default: "LoadPulse",
    template: "%s · LoadPulse",
  },
  description:
    "LoadPulse sends parallel requests to a website you own and shows latency, error rate and throughput second by second.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <DraftshipRoot />
        {children}
      </body>
    </html>
  );
}
