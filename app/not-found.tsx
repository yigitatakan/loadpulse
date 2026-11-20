import type { Metadata } from "next";
import Link from "next/link";
import { Activity } from "lucide-react";

export const metadata: Metadata = {
  title: "Page not found",
  description: "That page does not exist in LoadPulse.",
};

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Activity className="size-5" />
        </div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          The link may be old, or the run it pointed at may have been deleted.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to the console
        </Link>
      </div>
    </div>
  );
}
