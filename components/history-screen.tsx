"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronRight, GitCompareArrows } from "lucide-react";
import { Spinner } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";
import AppShell from "@/components/app-shell";
import { Card, EmptyState, Pill, SectionHeader } from "@/components/ui";
import {
  formatDateTime,
  formatMs,
  formatNumber,
  formatPercent,
  runStatusLabel,
  runStatusTone,
  shortHost,
  toRun,
  type RunRecord,
} from "@/lib/loadpulse";

export default function HistoryScreen() {
  return (
    <AppShell>
      <HistoryBody />
    </AppShell>
  );
}

function HistoryBody() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await ds.entities.TestRun.list("-created_date", 100);
      setRuns(records.map(toRun));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your runs could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">History</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Every run you have sent</h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Each burst is stored with its totals and its per-second buckets, so you can compare how your site
            behaved before and after a change.
          </p>
        </div>
        <Link
          href="/compare"
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-[14px] font-semibold transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GitCompareArrows className="size-4" />
          Compare runs
        </Link>
      </header>

      <Card>
        <SectionHeader title="Runs" description={loading ? "Loading…" : `${runs.length} saved`} />
        {loading ? (
          <div className="grid place-items-center py-16">
            <Spinner />
          </div>
        ) : error ? (
          <div className="px-5 pb-6 sm:px-6">
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">
              <p className="font-semibold">Runs could not be loaded</p>
              <p className="mt-1 opacity-90">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 inline-flex h-9 items-center rounded-lg bg-destructive/15 px-3 text-[13px] font-semibold text-destructive transition hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            </div>
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="size-5" />}
            title="No runs yet"
            description="Run your first load test from the console and it will be listed here."
            action={
              <Link
                href="/"
                className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open the console
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/history/${run.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition duration-200 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{shortHost(run.targetUrl)}</p>
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {formatDateTime(run.created_date || run.startedAt)} · {run.concurrency} connections ·{" "}
                      {run.durationSeconds}s
                      {run.proxyLabel && run.proxyLabel !== "Direct" ? ` · ${run.proxyLabel}` : ""}
                    </p>
                  </div>

                  <div className="hidden items-center gap-6 sm:flex">
                    <div className="w-20 text-right">
                      <p className="num text-[13px] font-semibold">{formatNumber(run.total)}</p>
                      <p className="text-[11px] text-muted-foreground">requests</p>
                    </div>
                    <div className="w-20 text-right">
                      <p
                        className={`num text-[13px] font-semibold ${
                          run.total > 0 && run.errors / run.total > 0.01 ? "text-destructive" : ""
                        }`}
                      >
                        {formatPercent(run.total > 0 ? run.errors / run.total : 0)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">errors</p>
                    </div>
                    <div className="w-20 text-right">
                      <p className="num text-[13px] font-semibold">{formatMs(run.avgLatency)}</p>
                      <p className="text-[11px] text-muted-foreground">avg</p>
                    </div>
                  </div>

                  <Pill tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Pill>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
