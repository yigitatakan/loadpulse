"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Globe2, Layers, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Spinner, toast } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";
import AppShell from "@/components/app-shell";
import { Card, EmptyState, Pill, SectionHeader } from "@/components/ui";
import { asRecord, recordId, timeAgo, toProxy, type ProxyRecord } from "@/lib/loadpulse";
import { LIMITS } from "@/lib/limits";

type SharedPool = {
  configured: boolean;
  host: string;
  username: string;
  portStart: number;
  portEnd: number;
  ports: number[];
};

const EMPTY_POOL: SharedPool = {
  configured: false,
  host: "",
  username: "",
  portStart: 0,
  portEnd: 0,
  ports: [],
};

export default function ProxiesScreen() {
  return (
    <AppShell>
      <ProxiesBody />
    </AppShell>
  );
}

function ProxiesBody() {
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [pool, setPool] = useState<SharedPool>(EMPTY_POOL);
  const [isAdmin, setIsAdmin] = useState(false);

  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("10001");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [rangeStart, setRangeStart] = useState("10001");
  const [rangeCount, setRangeCount] = useState("10");
  const [rangeLabel, setRangeLabel] = useState("My proxy pool");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await ds.entities.Proxy.list("-created_date", 100);
      setProxies(records.map(toProxy));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your proxies could not be loaded");
    } finally {
      setLoading(false);
    }

    try {
      const me = asRecord(await ds.auth.me());
      const admin = me.role === "admin";
      setIsAdmin(admin);
      if (!admin) {
        setPool(EMPTY_POOL);
        return;
      }
      const status = asRecord(await ds.functions.invoke("proxyStatus", { poolSize: 10 }));
      const ports = Array.isArray(status.ports)
        ? (status.ports as unknown[]).map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : [];
      setPool({
        configured: status.configured === true,
        host: typeof status.host === "string" ? status.host : "",
        username: typeof status.username === "string" ? status.username : "",
        portStart: Number(status.portStart ?? 0),
        portEnd: Number(status.portEnd ?? 0),
        ports,
      });
      if (typeof status.portStart === "number" && status.portStart > 0) {
        setRangeStart(String(status.portStart));
      }
      const savedHost = typeof status.host === "string" ? status.host : "";
      if (savedHost) setHost((current) => current || savedHost);
    } catch {
      setPool(EMPTY_POOL);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addProxy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const cleanHost = host.trim();
    const cleanPort = Number(port);
    if (!cleanHost) {
      setFormError("Enter the proxy host, for example proxy.example.com");
      return;
    }
    if (!Number.isFinite(cleanPort) || cleanPort < 1 || cleanPort > 65535) {
      setFormError("Enter a port between 1 and 65535");
      return;
    }

    setSaving(true);
    try {
      const created = await ds.entities.Proxy.create({
        label: label.trim() || `${cleanHost}:${cleanPort}`,
        host: cleanHost,
        port: cleanPort,
        username: username.trim(),
      });
      const proxyId = recordId(created);
      if (proxyId && password) {
        await ds.entities.ProxySecret.create({ proxyId, password });
      }
      toast.success("Proxy saved");
      setLabel("");
      setHost("");
      setPort("10001");
      setUsername("");
      setPassword("");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "The proxy could not be saved";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function importRange() {
    const start = Number(rangeStart);
    const count = Number(rangeCount);
    if (!Number.isFinite(start) || start < 1 || start > 65535) {
      toast.error("Enter a first port between 1 and 65535");
      return;
    }
    if (!Number.isFinite(count) || count < 1 || count > LIMITS.maxPoolPorts) {
      toast.error(`Pick between 1 and ${LIMITS.maxPoolPorts} ports`);
      return;
    }
    const cleanHost = host.trim();
    const cleanUser = username.trim();
    if (!cleanHost) {
      toast.error("Add the proxy host first");
      return;
    }
    if (!password) {
      toast.error("Enter the proxy password so the ports can be used");
      return;
    }

    setImporting(true);
    try {
      let created = 0;
      for (let index = 0; index < count; index += 1) {
        const nextPort = start + index;
        if (nextPort > 65535) break;
        const record = await ds.entities.Proxy.create({
          label: `${rangeLabel.trim() || "Proxy pool"} · ${nextPort}`,
          host: cleanHost,
          port: nextPort,
          username: cleanUser,
        });
        const proxyId = recordId(record);
        if (proxyId) await ds.entities.ProxySecret.create({ proxyId, password });
        created += 1;
      }
      toast.success(`${created} ports saved`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The ports could not be saved");
    } finally {
      setImporting(false);
    }
  }

  async function testProxy(proxy: ProxyRecord) {
    setTestingId(proxy.id);
    try {
      const result = asRecord(await ds.functions.invoke("checkProxy", { proxyId: proxy.id }));
      const ip = typeof result.ip === "string" ? result.ip : "";
      if (ip) {
        toast.success(`Exit IP ${ip}${result.country ? ` · ${String(result.country)}` : ""}`);
      } else {
        toast.success("Proxy answered");
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The proxy check failed");
      await load();
    } finally {
      setTestingId(null);
    }
  }

  async function removeProxy(proxy: ProxyRecord) {
    if (!window.confirm(`Delete the proxy ${proxy.label || proxy.host}?`)) return;
    try {
      const secrets = await ds.entities.ProxySecret.filter({ proxyId: proxy.id });
      for (const secret of secrets) {
        const id = recordId(secret);
        if (id) await ds.entities.ProxySecret.delete(id);
      }
      await ds.entities.Proxy.delete(proxy.id);
      toast.success("Proxy deleted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The proxy could not be deleted");
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary">Proxies</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your own proxy list</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Add the proxies you own and every burst you send can be spread across them. Rotating providers give a
          different exit IP on every port, so a port range is usually all you need.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Saved proxies</p>
          <p className="num mt-2 text-[22px] font-semibold leading-none">{loading ? "—" : proxies.length}</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Checked</p>
          <p className="num mt-2 text-[22px] font-semibold leading-none">
            {loading ? "—" : proxies.filter((proxy) => proxy.lastIp).length}
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Ports per burst</p>
          <p className="num mt-2 text-[22px] font-semibold leading-none">{LIMITS.maxPoolPorts}</p>
        </div>
      </div>

      {isAdmin && pool.configured ? (
        <Card>
          <SectionHeader
            title="Your shared pool"
            description="The PROXY_URL secret on this app, available to you as the owner."
            action={<Pill tone="success">PROXY_URL is set</Pill>}
          />
          <div className="px-5 pb-6 sm:px-6">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Host</dt>
                <dd className="num mt-1 truncate text-[14px] font-semibold">{pool.host}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Login</dt>
                <dd className="num mt-1 truncate text-[14px] font-semibold">{pool.username || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Ports in the pool
                </dt>
                <dd className="num mt-1 truncate text-[14px] font-semibold">
                  {pool.ports[0]}–{pool.ports[pool.ports.length - 1]}
                </dd>
              </div>
            </dl>
            <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
              <Layers className="mt-0.5 size-3.5 shrink-0 text-primary" />
              The console counts up from port {pool.portStart}. Up to {LIMITS.maxPoolPorts} ports can be used in one run.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <SectionHeader title="Your saved proxies" description={loading ? "Loading…" : `${proxies.length} saved`} />
          {loading ? (
            <div className="grid place-items-center py-16">
              <Spinner />
            </div>
          ) : error ? (
            <div className="px-5 pb-6 sm:px-6">
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">
                <p className="font-semibold">Proxies could not be loaded</p>
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
          ) : proxies.length === 0 ? (
            <EmptyState
              icon={<Globe2 className="size-5" />}
              title="No proxies yet"
              description="Import a port range on the right, or add a single proxy. Press Test to see the exit IP it gives you. You can also send traffic directly, without a proxy."
            />
          ) : (
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {proxies.map((proxy) => (
                <li key={proxy.id} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold">{proxy.label || proxy.host}</p>
                      <p className="num mt-0.5 truncate text-[12px] text-muted-foreground">
                        {proxy.username ? `${proxy.username}@` : ""}
                        {proxy.host}:{proxy.port}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void testProxy(proxy)}
                        disabled={testingId === proxy.id}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[12px] font-semibold transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      >
                        {testingId === proxy.id ? <Spinner /> : <RefreshCw className="size-3.5" />}
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeProxy(proxy)}
                        aria-label={`Delete ${proxy.label || proxy.host}`}
                        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {proxy.lastIp ? (
                      <Pill tone="success">Exit IP {proxy.lastIp}</Pill>
                    ) : (
                      <Pill tone="muted">Not checked yet</Pill>
                    )}
                    {proxy.lastCountry ? <Pill tone="primary">{proxy.lastCountry}</Pill> : null}
                    {proxy.lastCheckedAt ? (
                      <span className="text-[11px] text-muted-foreground">checked {timeAgo(proxy.lastCheckedAt)}</span>
                    ) : null}
                  </div>

                  {proxy.lastIsp ? (
                    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                      {proxy.lastIsp}
                      {proxy.lastCity ? ` · ${proxy.lastCity}` : ""}
                    </p>
                  ) : null}

                  {proxy.lastError ? (
                    <p className="mt-2 text-[12px] leading-relaxed text-destructive">{proxy.lastError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionHeader title="Import a port range" description="Same host and login, one port per exit IP." />
            <div className="space-y-4 px-5 pb-5 sm:px-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="range-start" className="block text-[13px] font-medium">
                    First port
                  </label>
                  <input
                    id="range-start"
                    value={rangeStart}
                    onChange={(event) => setRangeStart(event.target.value)}
                    inputMode="numeric"
                    className="num mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label htmlFor="range-count" className="block text-[13px] font-medium">
                    How many
                  </label>
                  <input
                    id="range-count"
                    value={rangeCount}
                    onChange={(event) => setRangeCount(event.target.value)}
                    inputMode="numeric"
                    className="num mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="range-label" className="block text-[13px] font-medium">
                  Label prefix
                </label>
                <input
                  id="range-label"
                  value={rangeLabel}
                  onChange={(event) => setRangeLabel(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Uses the host, username and password from the form below, so fill those in first. Up to{" "}
                {LIMITS.maxPoolPorts} ports per import.
              </p>

              <button
                type="button"
                onClick={() => void importRange()}
                disabled={importing}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {importing ? <Spinner /> : <Layers className="size-4" />}
                Save these ports
              </button>
            </div>
          </Card>

          <Card>
            <SectionHeader title="Add one proxy" description="HTTP proxies with optional username and password." />
            <form onSubmit={addProxy} className="space-y-4 px-5 pb-5 sm:px-6" noValidate>
              <div>
                <label htmlFor="proxy-label" className="block text-[13px] font-medium">
                  Label
                </label>
                <input
                  id="proxy-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="My residential proxy"
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
                <div>
                  <label htmlFor="proxy-host" className="block text-[13px] font-medium">
                    Host
                  </label>
                  <input
                    id="proxy-host"
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                    placeholder="proxy.example.com"
                    spellCheck={false}
                    className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label htmlFor="proxy-port" className="block text-[13px] font-medium">
                    Port
                  </label>
                  <input
                    id="proxy-port"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    inputMode="numeric"
                    className="num mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="proxy-username" className="block text-[13px] font-medium">
                  Username
                </label>
                <input
                  id="proxy-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div>
                <label htmlFor="proxy-password" className="block text-[13px] font-medium">
                  Password
                </label>
                <input
                  id="proxy-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  Stored in a separate record that only the server can read. It is never shown again.
                </p>
              </div>

              {formError ? <p className="text-[12px] font-medium text-destructive">{formError}</p> : null}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-[14px] font-semibold transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {saving ? <Spinner /> : <Plus className="size-4" />}
                Save proxy
              </button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
