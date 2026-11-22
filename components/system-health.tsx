"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Cpu, HardDrive, RefreshCw } from "lucide-react";
import { Spinner } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";
import { asRecord } from "@/lib/loadpulse";

export type SystemStats = {
  cpuPercent: number;
  cpuCores: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  processRssBytes: number;
  heapUsedBytes: number;
  uptimeSeconds: number;
  sampledAt: string;
};

function toStats(value: unknown): SystemStats {
  const r = asRecord(value);
  const num = (input: unknown) => {
    const parsed = typeof input === "number" ? input : Number(input);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    cpuPercent: num(r.cpuPercent),
    cpuCores: num(r.cpuCores),
    memoryUsedBytes: num(r.memoryUsedBytes),
    memoryLimitBytes: num(r.memoryLimitBytes),
    memoryPercent: num(r.memoryPercent),
    processRssBytes: num(r.processRssBytes),
    heapUsedBytes: num(r.heapUsedBytes),
    uptimeSeconds: num(r.uptimeSeconds),
    sampledAt: typeof r.sampledAt === "string" ? r.sampledAt : "",
  };
}

function formatMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

function Meter({
  label,
  percent,
  caption,
  tone,
}: {
  label: string;
  percent: number;
  caption: string;
  tone: "primary" | "accent";
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const barColor =
    tone === "accent" ? "var(--chart-2)" : clamped >= 85 ? "var(--destructive)" : "var(--primary)";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
        <span className="num text-[15px] font-semibold leading-none">{clamped.toFixed(1)}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(1.5, clamped)}%`, background: barColor }}
        />
      </div>
      <p className="num mt-1.5 text-[11px] text-muted-foreground">{caption}</p>
    </div>
  );
}

export default function SystemHealth({ active }: { active: boolean }) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const mounted = useRef(true);

  const sample = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const result = toStats(await ds.functions.invoke("systemStats", {}));
      if (!mounted.current) return;
      setStats(result);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "The container stats could not be read");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void sample(true);
    return () => {
      mounted.current = false;
    };
  }, [sample]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void sample(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [active, sample]);

  async function refresh() {
    setManual(true);
    await sample(false);
    setManual(false);
  }

  const cpuCaption = stats
    ? `${stats.cpuCores.toFixed(stats.cpuCores % 1 === 0 ? 0 : 2)} vCPU limit · sampled ${
        stats.sampledAt ? new Date(stats.sampledAt).toLocaleTimeString("en-US") : "just now"
      }`
    : "Waiting for the first sample";

  const memoryCaption = stats
    ? `${formatMb(stats.memoryUsedBytes)} of ${formatMb(stats.memoryLimitBytes)} used`
    : "Waiting for the first sample";

  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Activity className="size-4 text-primary" />
            Container CPU and RAM
          </h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              The shared machine that sends the traffic, sampled every two seconds.
              {active ? " Live while the run is going." : ""}
            </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={manual}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[12px] font-semibold transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {manual ? <Spinner /> : <RefreshCw className="size-3.5" />}
          Sample now
        </button>
      </div>

      <div className="px-5 pb-5 sm:px-6">
        {loading && !stats ? (
          <div className="grid place-items-center py-8">
            <Spinner />
          </div>
        ) : error && !stats ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-[13px] text-destructive">
            <p className="font-semibold">The container stats could not be read</p>
            <p className="mt-0.5 opacity-90">{error}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2.5 inline-flex h-8 items-center rounded-lg bg-destructive/15 px-2.5 text-[12px] font-semibold text-destructive transition hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
          </div>
        ) : stats ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Meter label="CPU" percent={stats.cpuPercent} caption={cpuCaption} tone="primary" />
              <Meter label="RAM" percent={stats.memoryPercent} caption={memoryCaption} tone="accent" />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-[12px] sm:grid-cols-4">
              <div>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Cpu className="size-3.5" />
                  CPU limit
                </dt>
                <dd className="num mt-0.5 font-semibold">
                  {stats.cpuCores.toFixed(stats.cpuCores % 1 === 0 ? 0 : 2)} vCPU
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <HardDrive className="size-3.5" />
                  Process memory
                </dt>
                <dd className="num mt-0.5 font-semibold">{formatMb(stats.processRssBytes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Heap in use</dt>
                <dd className="num mt-0.5 font-semibold">{formatMb(stats.heapUsedBytes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Process uptime</dt>
                <dd className="num mt-0.5 font-semibold">{formatUptime(stats.uptimeSeconds)}</dd>
              </div>
            </dl>

            {error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
