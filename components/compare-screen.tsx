"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GitCompareArrows } from "lucide-react";
import { Spinner } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";
import AppShell from "@/components/app-shell";
import LoadChart from "@/components/load-chart";
import type { ChartPoint } from "@/components/load-chart";
import { Card, EmptyState, SectionHeader } from "@/components/ui";
import {
  formatDateTime,
  formatMs,
  formatNumber,
  formatPercent,
  shortHost,
  toBucket,
  toRun,
  type BucketRecord,
  type RunRecord,
} from "@/lib/loadpulse";

export default function CompareScreen() {
  return (
    <AppShell>
      <CompareBody />
    </AppShell>
  );
}

function CompareBody() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [aBuckets, setABuckets] = useState<BucketRecord[]>([]);
  const [bBuckets, setBBuckets] = useState<BucketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await ds.entities.TestRun.list("-created_date", 50);
      const mapped = records.map(toRun);
      setRuns(mapped);
      setAId((current) => current || (mapped[0]?.id ?? ""));
      setBId((current) => current || (mapped[1]?.id ?? mapped[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your runs could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!aId) {
      setABuckets([]);
      return;
    }
    let cancelled = false;
    ds.entities.Bucket.filter({ runId: aId }, "second")
      .then((records) => {
        if (!cancelled) setABuckets(records.map(toBucket).sort((a, b) => a.second - b.second));
      })
      .catch(() => {
        if (!cancelled) setABuckets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [aId]);

  useEffect(() => {
    if (!bId) {
      setBBuckets([]);
      return;
    }
    let cancelled = false;
    ds.entities.Bucket.filter({ runId: bId }, "second")
      .then((records) => {
        if (!cancelled) setBBuckets(records.map(toBucket).sort((a, b) => a.second - b.second));
      })
      .catch(() => {
        if (!cancelled) setBBuckets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bId]);

  const runA = runs.find((run) => run.id === aId) ?? null;
  const runB = runs.find((run) => run.id === bId) ?? null;

  const pointsA: ChartPoint[] = useMemo(
    () =>
      aBuckets.map((bucket) => ({
        second: bucket.second,
        requests: bucket.requests,
        errors: bucket.errors,
        avgLatency: bucket.avgLatency,
      })),
    [aBuckets],
  );

  const pointsB: ChartPoint[] = useMemo(
    () =>
      bBuckets.map((bucket) => ({
        second: bucket.second,
        requests: bucket.requests,
        errors: bucket.errors,
        avgLatency: bucket.avgLatency,
      })),
    [bBuckets],
  );

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">Compare</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Two runs, side by side</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Put an earlier burst next to a later one to see whether latency or the error rate actually moved.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">
          <p className="font-semibold">Runs could not be loaded</p>
          <p className="mt-1 opacity-90">{error}</p>
          <button
            type="button"
            onClick={() => void loadRuns()}
            className="mt-3 inline-flex h-9 items-center rounded-lg bg-destructive/15 px-3 text-[13px] font-semibold text-destructive transition hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      ) : null}

      {runs.length < 2 ? (
        <Card>
          <EmptyState
            icon={<GitCompareArrows className="size-5" />}
            title="Two runs are needed to compare"
            description="Run a load test, change something on your site, then run it again. Both bursts will show up here."
            action={
              <Link
                href="/"
                className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open the console
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="run-a" className="block text-[13px] font-medium">
                Run A
              </label>
              <select
                id="run-a"
                value={aId}
                onChange={(event) => setAId(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {shortHost(run.targetUrl)} · {formatDateTime(run.created_date || run.startedAt)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="run-b" className="block text-[13px] font-medium">
                Run B
              </label>
              <select
                id="run-b"
                value={bId}
                onChange={(event) => setBId(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {shortHost(run.targetUrl)} · {formatDateTime(run.created_date || run.startedAt)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {runA && runB ? (
            <Card>
              <SectionHeader
                title="Head to head"
                description="The change column compares B against A."
              />
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-y border-border/60 bg-muted/40 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-6">
                <span>Metric</span>
                <span className="w-20 text-right">A</span>
                <span className="w-20 text-right">B</span>
                <span className="w-16 text-right">Change</span>
              </div>
              <div className="divide-y divide-border/60">
                <CompareRow
                  label="Requests"
                  a={runA.total}
                  b={runB.total}
                  better="higher"
                  format={(value) => formatNumber(value)}
                />
                <CompareRow
                  label="Requests / sec"
                  a={runA.rps}
                  b={runB.rps}
                  better="higher"
                  format={(value) => value.toFixed(1)}
                />
                <CompareRow
                  label="Error rate"
                  a={runA.total > 0 ? runA.errors / runA.total : 0}
                  b={runB.total > 0 ? runB.errors / runB.total : 0}
                  better="lower"
                  format={(value) => formatPercent(value)}
                />
                <CompareRow
                  label="Average latency"
                  a={runA.avgLatency}
                  b={runB.avgLatency}
                  better="lower"
                  format={(value) => formatMs(value)}
                />
                <CompareRow
                  label="p95 latency"
                  a={runA.p95Latency}
                  b={runB.p95Latency}
                  better="lower"
                  format={(value) => formatMs(value)}
                />
                <CompareRow
                  label="Parallel connections"
                  a={runA.concurrency}
                  b={runB.concurrency}
                  better="higher"
                  format={(value) => String(Math.round(value))}
                />
              </div>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionHeader
                title={`Run A · ${runA ? shortHost(runA.targetUrl) : ""}`}
                description={runA ? formatDateTime(runA.created_date || runA.startedAt) : undefined}
              />
              <div className="px-3 pb-5 sm:px-5">
                <LoadChart series={[{ label: "Run A", points: pointsA }]} metric="latency" height={200} />
              </div>
            </Card>
            <Card>
              <SectionHeader
                title={`Run B · ${runB ? shortHost(runB.targetUrl) : ""}`}
                description={runB ? formatDateTime(runB.created_date || runB.startedAt) : undefined}
              />
              <div className="px-3 pb-5 sm:px-5">
                <LoadChart
                  series={[{ label: "Run B", points: pointsB, color: "var(--chart-2)" }]}
                  metric="latency"
                  height={200}
                />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function CompareRow({
  label,
  a,
  b,
  better,
  format,
}: {
  label: string;
  a: number;
  b: number;
  better: "higher" | "lower";
  format: (value: number) => string;
}) {
  const diff = b - a;
  const pct = a > 0 ? (diff / a) * 100 : 0;
  const good = better === "higher" ? diff > 0 : diff < 0;
  const tone =
    Math.abs(pct) < 1 ? "text-muted-foreground" : good ? "text-success" : "text-destructive";

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-5 py-3 sm:px-6">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="num w-20 text-right text-[13px] font-semibold">{format(a)}</span>
      <span className="num w-20 text-right text-[13px] font-semibold">{format(b)}</span>
      <span className={`num w-16 text-right text-[12px] font-semibold ${tone}`}>
        {a > 0 ? `${diff >= 0 ? "+" : ""}${pct.toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}
