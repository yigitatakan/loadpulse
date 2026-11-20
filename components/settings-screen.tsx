"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Spinner, toast } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";
import AppShell from "@/components/app-shell";
import { Card, EmptyState, Pill, SectionHeader } from "@/components/ui";
import { LIMITS } from "@/lib/limits";
import {
  asRecord,
  recordId,
  shortHost,
  timeAgo,
  toPreferences,
  toTarget,
  type TargetRecord,
} from "@/lib/loadpulse";

const DURATIONS = [5, 10, 15, 30, 45];

export default function SettingsScreen() {
  return (
    <AppShell>
      <SettingsBody />
    </AppShell>
  );
}

function SettingsBody() {
  const [concurrency, setConcurrency] = useState<number>(10);
  const [duration, setDuration] = useState<number>(10);
  const [prefsId, setPrefsId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [proxyUrlConfigured, setProxyUrlConfigured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prefRecords, targetRecords] = await Promise.all([
        ds.entities.Preferences.list("-created_date", 1),
        ds.entities.Target.list("-created_date", 100),
      ]);
        if (prefRecords.length > 0) {
          const prefs = toPreferences(prefRecords[0]);
          setPrefsId(prefs.id);
          if (prefs.concurrency >= 1) setConcurrency(Math.min(LIMITS.maxConcurrency, Math.round(prefs.concurrency)));
          if (prefs.duration >= 3) setDuration(Math.min(LIMITS.maxDuration, Math.max(3, Math.round(prefs.duration))));
        }
      setTargets(targetRecords.map(toTarget));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Settings could not be loaded");
    } finally {
      setLoading(false);
    }
    try {
      const status = asRecord(await ds.functions.invoke("proxyStatus", {}));
      setProxyUrlConfigured(status.configured === true);
    } catch {
      setProxyUrlConfigured(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDefaults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (prefsId) {
        await ds.entities.Preferences.update(prefsId, {
          defaultConcurrency: concurrency,
          defaultDuration: duration,
        });
      } else {
        const created = await ds.entities.Preferences.create({
          defaultConcurrency: concurrency,
          defaultDuration: duration,
        });
        setPrefsId(recordId(created));
      }
      toast.success("Defaults saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The defaults could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAutoCheck(target: TargetRecord) {
    try {
      await ds.entities.Target.update(target.id, { autoCheck: !target.autoCheck });
      toast.success(target.autoCheck ? "Automatic checks off" : "Automatic checks on");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The site could not be updated");
    }
  }

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
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">Settings</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">How LoadPulse behaves</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Defaults for new tests, the scheduled health check, and the limits every run stays inside.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">
          <p className="font-semibold">Settings could not be loaded</p>
          <p className="mt-1 opacity-90">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex h-9 items-center rounded-lg bg-destructive/15 px-3 text-[13px] font-semibold text-destructive transition hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <SectionHeader title="Defaults" description="What the console opens with." />
          <form onSubmit={saveDefaults} className="space-y-6 px-5 pb-6 sm:px-6">
            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="default-concurrency" className="text-[13px] font-medium">
                  Parallel connections
                </label>
                <span className="num rounded-md bg-muted px-2 py-0.5 text-[12px] font-semibold">
                  {concurrency}
                </span>
              </div>
                <input
                  id="default-concurrency"
                  type="range"
                  min={LIMITS.minConcurrency}
                  max={LIMITS.maxConcurrency}
                  step={1}
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
                className="mt-4 w-full accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label htmlFor="default-duration" className="block text-[13px] font-medium">
                Test duration
              </label>
              <select
                id="default-duration"
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {DURATIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {saving ? <Spinner /> : null}
              Save defaults
            </button>
          </form>
        </Card>

        <Card>
            <SectionHeader title="Limits" description="Fixed for every run." />
            <dl className="divide-y divide-border/60 px-5 pb-5 text-[13px] sm:px-6">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Max connections</dt>
                <dd className="num font-medium">{LIMITS.maxConcurrency}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Max duration</dt>
                <dd className="num font-medium">{LIMITS.maxDuration} s</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Max requests</dt>
                <dd className="num font-medium">{new Intl.NumberFormat("en-US").format(LIMITS.maxRequests)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Request timeout</dt>
                <dd className="num font-medium">{LIMITS.requestTimeoutMs / 1000} s</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-muted-foreground">Proxy ports per run</dt>
                <dd className="num font-medium">up to {LIMITS.maxPoolPorts}</dd>
              </div>
            </dl>
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Scheduled checks"
          description="LoadPulse re-checks the sites you switch on every 30 minutes."
          action={
            <Pill tone={proxyUrlConfigured ? "success" : "muted"}>
              {proxyUrlConfigured ? "PROXY_URL set" : "No default proxy"}
            </Pill>
          }
        />
        <div className="px-5 pb-5 sm:px-6">
          {targets.length === 0 ? (
            <EmptyState
              icon={<Settings2 className="size-5" />}
              title="No saved sites"
              description="Save a site from the console first, then switch its automatic checks on here."
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
            <ul className="divide-y divide-border/60">
              {targets.map((target) => (
                <li key={target.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{target.label || shortHost(target.url)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {target.url}
                      {target.lastChecked ? ` · checked ${timeAgo(target.lastChecked)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleAutoCheck(target)}
                    aria-pressed={target.autoCheck}
                    className={`inline-flex h-9 items-center rounded-full px-3 text-[12px] font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      target.autoCheck
                        ? "bg-success/10 text-success"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {target.autoCheck ? "Checks on" : "Checks off"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <SectionHeader title="Good to know" />
          <div className="space-y-3 px-5 pb-6 text-[13px] leading-relaxed text-muted-foreground sm:px-6">
            <p>
              A website&apos;s CPU and RAM cannot be read from the outside, so LoadPulse reports what traffic
              actually feels: response time, error rate and throughput. The console also shows the CPU and RAM of the
              container sending the traffic, sampled live.
            </p>
              <p>
                The app runs in a small container, so a burst is capped at {LIMITS.maxConcurrency} connections,{" "}
                {LIMITS.maxDuration} seconds and {new Intl.NumberFormat("en-US").format(LIMITS.maxRequests)} requests.
                For a longer soak test, run it from a machine you control.
              </p>
              <p>
                Only HTTP and HTTPS proxies are supported. The exit-IP check calls the public IP-info endpoint
                through the proxy you saved.
              </p>
        </div>
      </Card>
    </div>
  );
}
