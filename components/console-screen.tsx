"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleStop,
  Gauge,
  Globe2,
  Layers,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Spinner, toast } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";
import AppShell from "@/components/app-shell";
import LoadChart from "@/components/load-chart";
import SystemHealth from "@/components/system-health";
import type { ChartPoint } from "@/components/load-chart";
import { Card, EmptyState, Pill, SectionHeader, Stat } from "@/components/ui";
import {
  asRecord,
  formatDateTime,
  formatMs,
  formatNumber,
  formatPercent,
  recordId,
  runStatusLabel,
  runStatusTone,
  shortHost,
  toBucket,
  toPreferences,
  toProxy,
  toRun,
  toTarget,
  type BucketRecord,
  type ProxyRecord,
  type RunRecord,
  type TargetRecord,
} from "@/lib/loadpulse";
import { CONCURRENCY_PRESETS, DURATION_PRESETS, LIMITS, POOL_PRESETS } from "@/lib/limits";

function makeKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type ProxyStatus = {
  configured: boolean;
  host: string;
  username: string;
  portStart: number;
  portEnd: number;
  ports: number[];
};

const EMPTY_STATUS: ProxyStatus = {
  configured: false,
  host: "",
  username: "",
  portStart: 0,
  portEnd: 0,
  ports: [],
};

export default function ConsoleScreen() {
  return (
    <AppShell>
      <ConsoleBody />
    </AppShell>
  );
}

function ConsoleBody() {
  const [url, setUrl] = useState("");
  const [concurrency, setConcurrency] = useState<number>(LIMITS.defaultConcurrency);
  const [duration, setDuration] = useState<number>(LIMITS.defaultDuration);
  const [proxyChoice, setProxyChoice] = useState("direct");
  const [poolSize, setPoolSize] = useState<number>(LIMITS.defaultPoolPorts);
  const [insecureTls, setInsecureTls] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [clientKey, setClientKey] = useState("");
  const [liveRun, setLiveRun] = useState<RunRecord | null>(null);
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [metric, setMetric] = useState<"latency" | "requests">("latency");

  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [recent, setRecent] = useState<RunRecord[]>([]);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>(EMPTY_STATUS);
  const [dataLoading, setDataLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  const unsubscribes = useRef<Array<() => void>>([]);

  const cleanupSubscriptions = useCallback(() => {
    for (const stop of unsubscribes.current) {
      try {
        stop();
      } catch {
        /* already closed */
      }
    }
    unsubscribes.current = [];
  }, []);

  useEffect(() => {
    return () => {
      cleanupSubscriptions();
    };
  }, [cleanupSubscriptions]);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [targetRecords, proxyRecords, runRecords, prefRecords] = await Promise.all([
        ds.entities.Target.list("-created_date", 50),
        ds.entities.Proxy.list("-created_date", 50),
        ds.entities.TestRun.list("-created_date", 5),
        ds.entities.Preferences.list("-created_date", 1),
      ]);
      setTargets(targetRecords.map(toTarget));
      setProxies(proxyRecords.map(toProxy));
      setRecent(runRecords.map(toRun));

      if (prefRecords.length > 0) {
        const prefs = toPreferences(prefRecords[0]);
        if (prefs.concurrency >= 1) {
          setConcurrency(Math.min(LIMITS.maxConcurrency, Math.round(prefs.concurrency)));
        }
        if (prefs.duration >= 3) {
          setDuration(Math.min(LIMITS.maxDuration, Math.max(3, Math.round(prefs.duration))));
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Your saved data could not be loaded");
    } finally {
      setDataLoading(false);
    }

    try {
      const status = asRecord(await ds.functions.invoke("proxyStatus", { poolSize: 10 }));
      const ports = Array.isArray(status.ports)
        ? (status.ports as unknown[]).map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : [];
      setProxyStatus({
        configured: status.configured === true,
        host: typeof status.host === "string" ? status.host : "",
        username: typeof status.username === "string" ? status.username : "",
        portStart: Number(status.portStart ?? 0),
        portEnd: Number(status.portEnd ?? 0),
        ports,
      });
    } catch {
      setProxyStatus(EMPTY_STATUS);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totals = useMemo(() => {
    let requests = 0;
    let errors = 0;
    let weightedLatency = 0;
    for (const bucket of buckets) {
      requests += bucket.requests;
      errors += bucket.errors;
      weightedLatency += bucket.avgLatency * bucket.requests;
    }
    const seconds = buckets.length > 0 ? buckets[buckets.length - 1].second + 1 : 0;
    return {
      requests,
      errors,
      seconds,
      successRate: requests > 0 ? (requests - errors) / requests : 0,
      avgLatency: requests > 0 ? weightedLatency / requests : 0,
      rps: seconds > 0 ? requests / seconds : 0,
    };
  }, [buckets]);

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

  const usesProxy = proxyChoice !== "direct";
  const plannedPorts = usesProxy ? poolSize : 0;
  const maxRequestsHint = Math.min(LIMITS.maxRequests, concurrency * duration * 60);

  async function startTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStartError(null);
    setConfirmError(null);

    const trimmed = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setUrlError("Enter the full address, including https://");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setUrlError("Only http:// and https:// addresses can be tested");
      return;
    }
    setUrlError(null);

    if (!confirmed) {
      setConfirmError("Confirm that you own or are authorised to test this site");
      return;
    }

    cleanupSubscriptions();
    const key = makeKey();
    setClientKey(key);
    setBuckets([]);
    setLiveRun(null);
    setRunning(true);

    try {
      unsubscribes.current.push(
        ds.entities.TestRun.subscribe(
          (records) => {
            const runs = records.map(toRun);
            if (runs.length > 0) setLiveRun(runs[0]);
          },
          { clientKey: key },
        ),
      );
      unsubscribes.current.push(
        ds.entities.Bucket.subscribe(
          (records) => {
            setBuckets(records.map(toBucket).sort((a, b) => a.second - b.second));
          },
          { clientKey: key },
        ),
      );
    } catch {
      /* live updates are a bonus; the final refresh below still fills the page */
    }

    try {
      await ds.functions.invoke("runLoadTest", {
        clientKey: key,
        targetUrl: parsed.toString(),
        concurrency,
        durationSeconds: duration,
        proxyChoice,
        proxyPoolSize: poolSize,
        insecureTls,
      });
      toast.success("Load test finished");
    } catch (err) {
      const message = err instanceof Error ? err.message : "The load test could not run";
      setStartError(message);
      toast.error(message);
    } finally {
      try {
        const finalRuns = await ds.entities.TestRun.filter({ clientKey: key }, "-created_date");
        const runs = finalRuns.map(toRun);
        if (runs[0]) setLiveRun(runs[0]);
        const finalBuckets = await ds.entities.Bucket.filter({ clientKey: key }, "second");
        setBuckets(finalBuckets.map(toBucket).sort((a, b) => a.second - b.second));
      } catch {
        /* keep whatever the live feed delivered */
      }
      cleanupSubscriptions();
      setRunning(false);
      void loadData();
    }
  }

  async function stopTest() {
    if (!clientKey) return;
    try {
      await ds.functions.invoke("stopLoadTest", { clientKey });
      toast.success("Stopping after the requests in flight finish");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The run could not be stopped");
    }
  }

  async function saveTarget() {
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlError("Enter an address before saving the site");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setUrlError("Enter the full address, including https://");
      return;
    }
    setUrlError(null);
    setSavingTarget(true);
    try {
      await ds.entities.Target.create({
        label: newLabel.trim() || parsed.host,
        url: parsed.toString(),
        autoCheck: false,
      });
      setNewLabel("");
      toast.success("Site saved");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The site could not be saved");
    } finally {
      setSavingTarget(false);
    }
  }

  async function removeTarget(target: TargetRecord) {
    if (!window.confirm(`Remove ${target.label || target.url} from saved sites?`)) return;
    try {
      await ds.entities.Target.delete(target.id);
      toast.success("Site removed");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The site could not be removed");
    }
  }

  const showLive = running || liveRun !== null || buckets.length > 0;
  const status = running ? "running" : liveRun ? liveRun.status : "idle";
  const statusTone = runStatusTone(status === "idle" ? "completed" : status);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">Load testing</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Send parallel traffic to your own site
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Type the address of a site you own, pick how many connections to open at once and whether to spread them
          over a range of proxy ports. Latency, error rate and throughput arrive second by second.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <form onSubmit={startTest} className="p-5 sm:p-6" noValidate>
            <div className="space-y-2">
              <label htmlFor="target-url" className="block text-[13px] font-medium">
                Website address
              </label>
              <input
                id="target-url"
                name="targetUrl"
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://your-site.com"
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? "target-url-error" : "target-url-hint"}
                className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-[15px] outline-none transition duration-200 placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
              {urlError ? (
                <p id="target-url-error" className="text-[12px] font-medium text-destructive">
                  {urlError}
                </p>
              ) : (
                <p id="target-url-hint" className="text-[12px] leading-relaxed text-muted-foreground">
                  Include http:// or https://. Only test sites you own or have permission to test.
                </p>
              )}
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="concurrency" className="text-[13px] font-medium">
                    Parallel connections
                  </label>
                  <span className="num rounded-md bg-muted px-2 py-0.5 text-[12px] font-semibold">
                    {concurrency}
                  </span>
                </div>
                <input
                  id="concurrency"
                  type="range"
                  min={LIMITS.minConcurrency}
                  max={LIMITS.maxConcurrency}
                  step={1}
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                  className="mt-4 w-full accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>{LIMITS.minConcurrency}</span>
                  <span>{LIMITS.maxConcurrency}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {CONCURRENCY_PRESETS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setConcurrency(value)}
                      aria-pressed={concurrency === value}
                      className={`num h-8 rounded-lg px-2.5 text-[12px] font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        concurrency === value
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[13px] font-medium">Test duration</span>
                <div className="mt-3 inline-flex flex-wrap rounded-xl bg-muted p-1" role="group" aria-label="Test duration">
                  {DURATION_PRESETS.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      onClick={() => setDuration(seconds)}
                      aria-pressed={duration === seconds}
                      className={`num h-9 rounded-lg px-2.5 text-[13px] font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        duration === seconds
                          ? "bg-card text-foreground shadow-soft"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {seconds}s
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                  A run stops at {duration} s or when it reaches {formatNumber(maxRequestsHint)} requests.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <label htmlFor="proxy-choice" className="block text-[13px] font-medium">
                Route through
              </label>
              <select
                id="proxy-choice"
                value={proxyChoice}
                onChange={(event) => setProxyChoice(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="direct">Direct connection (no proxy)</option>
                {proxyStatus.configured ? (
                  <option value="saved">
                    Saved proxy pool (PROXY_URL{proxyStatus.portStart ? ` · ports from ${proxyStatus.portStart}` : ""})
                  </option>
                ) : null}
                {proxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxy.label || `${proxy.host}:${proxy.port}`}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Add or test proxies on the{" "}
                <Link href="/proxies" className="text-primary underline-offset-2 hover:underline">
                  Proxies page
                </Link>
                .
              </p>
            </div>

            {usesProxy ? (
              <div className="mt-6 rounded-xl border border-border/60 bg-muted/40 p-4">
                <div className="flex items-start gap-2.5">
                  <Layers className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">Ports in the pool</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                      Every port gives a different exit IP. LoadPulse keeps the same host and login and counts up
                      from the saved port, so {poolSize} ports mean {poolSize} exit IPs.
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {POOL_PRESETS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPoolSize(value)}
                      aria-pressed={poolSize === value}
                      className={`num h-9 rounded-lg px-3 text-[12px] font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        poolSize === value
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {value} {value === 1 ? "port" : "ports"}
                    </button>
                  ))}
                </div>
                <p className="num mt-3 text-[12px] text-muted-foreground">
                  {proxyChoice === "saved" && proxyStatus.portStart > 0
                    ? `${proxyStatus.host || "saved proxy"} · ports ${proxyStatus.portStart}–${proxyStatus.portStart + poolSize - 1}`
                    : "Ports start at the port saved with the proxy you picked."}
                </p>
              </div>
            ) : null}

            <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl bg-muted/60 p-3.5">
              <input
                type="checkbox"
                checked={insecureTls}
                onChange={(event) => setInsecureTls(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="text-[13px] leading-relaxed text-muted-foreground">
                Ignore certificate errors — only for a staging site with a self-signed certificate.
              </span>
            </label>

            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl bg-muted/60 p-3.5">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="text-[13px] leading-relaxed text-muted-foreground">
                I own this website or have permission to send test traffic to it.
              </span>
            </label>
            {confirmError ? (
              <p className="mt-1.5 text-[12px] font-medium text-destructive">{confirmError}</p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={running}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {running ? <Spinner /> : <Play className="size-4" />}
                {running ? "Running…" : "Start load test"}
              </button>

              {running ? (
                <button
                  type="button"
                  onClick={stopTest}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-[15px] font-semibold transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CircleStop className="size-4" />
                  Stop
                </button>
              ) : null}

              <p className="text-[12px] text-muted-foreground">
                {formatNumber(concurrency)} connections · {duration}s
                {usesProxy ? ` · ${plannedPorts} ports` : " · direct"}
              </p>
            </div>

            {startError ? (
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="text-[13px] leading-relaxed text-destructive">
                  <p className="font-semibold">The test could not start</p>
                  <p className="mt-0.5 opacity-90">{startError}</p>
                </div>
              </div>
            ) : null}
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionHeader title="Saved sites" description="Reuse an address and let LoadPulse check it on a schedule." />
            <div className="px-5 pb-5 sm:px-6">
              <div className="flex gap-2">
                <input
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder="Label (optional)"
                  aria-label="Label for the saved site"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={saveTarget}
                  disabled={savingTarget}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary/10 px-3 text-[13px] font-semibold text-primary transition duration-200 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {savingTarget ? <Spinner /> : <Plus className="size-4" />}
                  Save
                </button>
              </div>

              {dataLoading ? (
                <div className="grid place-items-center py-8">
                  <Spinner />
                </div>
              ) : targets.length === 0 ? (
                <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
                  No saved sites yet. Type an address above and press Save to keep it here.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border/60">
                  {targets.map((target) => (
                    <li key={target.id} className="flex items-center gap-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => setUrl(target.url)}
                        className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block truncate text-[13px] font-medium">
                          {target.label || shortHost(target.url)}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">{target.url}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeTarget(target)}
                        aria-label={`Remove ${target.label || target.url}`}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

            {!showLive ? <SystemHealth active={false} /> : null}

            <Card>
              <SectionHeader title="Recent runs" description="The last few tests, newest first." />
            <div className="px-5 pb-5 sm:px-6">
              {recent.length === 0 ? (
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Nothing yet. Your first run will appear here and in History.
                </p>
              ) : (
                <ul className="space-y-2">
                  {recent.slice(0, 3).map((run) => (
                    <li key={run.id}>
                      <Link
                        href={`/history/${run.id}`}
                        className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 transition duration-200 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {shortHost(run.targetUrl)}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {formatDateTime(run.created_date || run.startedAt)} · {formatNumber(run.total)} req
                          </span>
                        </span>
                        <Pill tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/history"
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                All runs
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {showLive ? (
        <section className="space-y-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight">Live results</h2>
              <p className="truncate text-[13px] text-muted-foreground">
                {liveRun ? shortHost(liveRun.targetUrl) : shortHost(url)}
                {liveRun && liveRun.concurrency > 0
                  ? ` · ${liveRun.concurrency} connections · ${liveRun.durationSeconds}s · ${liveRun.proxyLabel || "Direct"}`
                  : ""}
              </p>
            </div>
            <Pill tone={statusTone}>
              {running ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
                  Running
                </span>
              ) : (
                runStatusLabel(status)
              )}
            </Pill>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Requests" value={formatNumber(totals.requests)} hint={`${totals.seconds}s recorded`} />
            <Stat label="Requests / sec" value={totals.rps.toFixed(1)} tone="accent" />
            <Stat
              label="Success rate"
              value={totals.requests > 0 ? formatPercent(totals.successRate) : "—"}
              tone={totals.requests > 0 && totals.errors === 0 ? "good" : "default"}
            />
            <Stat
              label="Errors"
              value={formatNumber(totals.errors)}
              tone={totals.errors > 0 ? "bad" : "default"}
              hint={totals.requests > 0 ? formatPercent(totals.errors / totals.requests) : undefined}
            />
            <Stat label="Avg latency" value={formatMs(totals.avgLatency)} />
            <Stat label="p95 latency" value={formatMs(liveRun?.p95Latency ?? 0)} />
          </div>

            <SystemHealth active={running} />

            <Card>
              <SectionHeader
                title="Throughput and latency"
              description="One point per second of the run."
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
              <LoadChart series={[{ label: "This run", points: chartPoints }]} metric={metric} />
            </div>
          </Card>

          {!running && liveRun && liveRun.status === "completed" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/history/${liveRun.id}`}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-[14px] font-semibold transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open this run
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/compare"
                className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold text-primary transition duration-200 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Compare runs
              </Link>
            </div>
          ) : null}
        </section>
      ) : (
        <Card>
          <EmptyState
            icon={<Globe2 className="size-5" />}
            title="No run on screen yet"
            description="Start a test above and the metric cards, the live chart and the per-second buckets appear here as the traffic flows."
            action={
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                Owner-only console
              </span>
            }
          />
        </Card>
      )}

      <Card>
        <SectionHeader
          title="Why the server CPU stays low"
          description="What the container actually does during a burst, and where the bottleneck usually is."
          action={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              <Gauge className="size-3.5" />
              Read this first
            </span>
          }
        />
          <div className="space-y-3 px-5 pb-6 text-[13px] leading-relaxed text-muted-foreground sm:px-6">
            <p>
              The container panel above samples the CPU and RAM of the machine running LoadPulse every few seconds.
              Your target site&apos;s own CPU and RAM cannot be read from the outside, so watch those on that server
              with its own monitoring. What you can measure from here is how it responds under pressure: latency,
              error rate and throughput.
            </p>
            <p>
              A load generator spends its time waiting, not computing. Each connection is mostly idle between the
            moment a request leaves and the response comes back, so even a few hundred open connections barely
            register on one CPU. Seeing under 10% CPU is normal and does not mean the traffic is not going out.
          </p>
          <p>
            The numbers that matter are on the live cards above: requests per second, success rate and latency. If
            requests per second stops rising while you raise connections, the limit is either this container
            (512 MB and one CPU) or the target site, not the setting.
          </p>
          <p>
            The app runs in a single small container, so one burst is capped at {LIMITS.maxConcurrency} connections,{" "}
            {LIMITS.maxDuration} seconds and {formatNumber(LIMITS.maxRequests)} requests. For a longer soak test,
            run a generator from a machine you control.
          </p>
        </div>
      </Card>
    </div>
  );
}
