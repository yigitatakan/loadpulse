"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitCompareArrows, RefreshCw } from "lucide-react";
import { Spinner } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";
import AppShell from "@/components/app-shell";
import LoadChart from "@/components/load-chart";
import type { ChartPoint } from "@/components/load-chart";
import { Card, Pill, SectionHeader, Stat } from "@/components/ui";
import {
  formatDateTime,
  formatMs,
  formatNumber,
  formatPercent,
  runStatusLabel,
  runStatusTone,
  shortHost,
  toBucket,
  toRun,
  type BucketRecord,
  type RunRecord,
} from "@/lib/loadpulse";

export default function RunDetailScreen({ runId }: { runId: string }) {
  return (
    <AppShell>
      <RunDetailBody runId={runId} />
    </AppShell>
  );
}

function RunDetailBody({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<"latency" | "requests">("latency");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [record, bucketRecords] = await Promise.all([
        ds.entities.TestRun.get(runId),
        ds.entities.Bucket.filter({ runId }, "second"),
      ]);
      setRun(toRun(record));
      setBuckets(bucketRecords.map(toBucket).sort((a, b) => a.second - b.second));
    } catch (err) {
      setError(err instanceof Error ? err.message : "This run could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartPoints: ChartPoint[] = useMemo(
    () =>
      buckets.map((bucket) => ({
        second: bucket.second,
        requests: bucket.requests,
        errors: bucket.errors,
        avgLatency: bucket.avgLatency,
      })),
    [buckets],
  );

  const codes = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const bucket of buckets) {
      for (const [code, count] of Object.entries(bucket.statusCodes)) {
        merged[code] = (merged[code] ?? 0) + count;
      }
    }
    return Object.entries(merged).sort((a, b) => b[1] - a[1]);
  }, [buckets]);

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-border/60 bg-card p-6 text-center shadow-soft">
        <h1 className="text-xl font-semibold tracking-tight">This run could not be opened</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {error ?? "The run no longer exists."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="size-4" />
            Try again
          </button>
          <Link
            href="/history"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-[14px] font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" />
            Back to history
          </Link>
        </div>
      </div>
    );
  }

  const errorRate = run.total > 0 ? run.errors / run.total : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/history"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" />
          History
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
              {shortHost(run.targetUrl)}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {formatDateTime(run.startedAt || run.created_date)} · {run.concurrency} connections ·{" "}
              {run.durationSeconds}s · {run.proxyLabel || "Direct"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Pill tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Pill>
            <Link
              href={`/compare?a=${run.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-[14px] font-semibold transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GitCompareArrows className="size-4" />
              Compare
            </Link>
          </div>
        </div>
      </div>

      {run.errorMessage ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">
          <p className="font-semibold">This run reported a problem</p>
          <p className="mt-1 opacity-90">{run.errorMessage}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Requests" value={formatNumber(run.total)} />
        <Stat label="Requests / sec" value={run.rps.toFixed(1)} tone="accent" />
        <Stat
          label="Success rate"
          value={formatPercent(1 - errorRate)}
          tone={errorRate === 0 ? "good" : "default"}
        />
        <Stat label="Errors" value={formatNumber(run.errors)} tone={run.errors > 0 ? "bad" : "default"} />
        <Stat label="Avg latency" value={formatMs(run.avgLatency)} hint={`min ${formatMs(run.minLatency)}`} />
        <Stat label="p95 latency" value={formatMs(run.p95Latency)} hint={`max ${formatMs(run.maxLatency)}`} />
      </div>

      <Card>
        <SectionHeader
          title="Second by second"
          description={run.status === "running" ? "This run is still in progress." : "Recorded buckets for this burst."}
          action={
            <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Chart metric">
              <button
                type="button"
                onClick={() => setMetric("latency")}
                aria-pressed={metric === "latency"}
                className={`h-8 rounded-lg px-3 text-[12px] font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  metric === "latency" ? "bg-card shadow-soft" : "text-muted-foreground"
                }`}
              >
                Latency
              </button>
              <button
                type="button"
                onClick={() => setMetric("requests")}
                aria-pressed={metric === "requests"}
                className={`h-8 rounded-lg px-3 text-[12px] font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  metric === "requests" ? "bg-card shadow-soft" : "text-muted-foreground"
                }`}
              >
                Requests
              </button>
            </div>
          }
        />
        <div className="px-3 pb-5 sm:px-5">
          <LoadChart series={[{ label: shortHost(run.targetUrl), points: chartPoints }]} metric={metric} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Response codes" description="How the target answered each request." />
          <div className="px-5 pb-5 sm:px-6">
            {codes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No responses were recorded for this run.</p>
            ) : (
              <ul className="space-y-2">
                {codes.map(([code, count]) => {
                  const share = run.total > 0 ? count / run.total : 0;
                  const failed = code === "network" || Number(code) >= 400;
                  return (
                    <li key={code} className="flex items-center gap-3">
                      <span
                        className={`num w-16 shrink-0 text-[13px] font-semibold ${
                          failed ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {code === "network" ? "network" : code}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(2, share * 100)}%`,
                            background: failed ? "var(--destructive)" : "var(--chart-1)",
                          }}
                        />
                      </span>
                      <span className="num w-20 shrink-0 text-right text-[12px] text-muted-foreground">
                        {formatNumber(count)} · {formatPercent(share)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <SectionHeader title="Run details" />
          <dl className="divide-y divide-border/60 px-5 pb-5 text-[13px] sm:px-6">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Address</dt>
              <dd className="truncate font-medium">{run.targetUrl}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Parallel connections</dt>
              <dd className="num font-medium">{run.concurrency}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="num font-medium">{run.durationSeconds}s</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Route</dt>
              <dd className="font-medium">{run.proxyLabel || "Direct"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Started</dt>
              <dd className="font-medium">{formatDateTime(run.startedAt || run.created_date)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Finished</dt>
              <dd className="font-medium">{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
