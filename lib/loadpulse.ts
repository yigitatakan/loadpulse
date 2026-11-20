export type RunRecord = {
  id: string;
  clientKey: string;
  targetUrl: string;
  label: string;
  concurrency: number;
  durationSeconds: number;
  status: string;
  total: number;
  success: number;
  errors: number;
  avgLatency: number;
  p95Latency: number;
  minLatency: number;
  maxLatency: number;
  rps: number;
  proxyLabel: string;
  errorMessage: string;
  startedAt: string;
  finishedAt: string;
  created_date: string;
};

export type BucketRecord = {
  id: string;
  runId: string;
  clientKey: string;
  second: number;
  requests: number;
  errors: number;
  avgLatency: number;
  statusCodes: Record<string, number>;
};

export type TargetRecord = {
  id: string;
  label: string;
  url: string;
  notes: string;
  autoCheck: boolean;
  lastChecked: string;
};

export type ProxyRecord = {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  lastIp: string;
  lastCountry: string;
  lastIsp: string;
  lastCity: string;
  lastCheckedAt: string;
  lastError: string;
};

export type PreferencesRecord = {
  id: string;
  concurrency: number;
  duration: number;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown): boolean {
  return value === true || value === "true";
}

export function recordId(value: unknown): string {
  return str(asRecord(value).id);
}

function toCodeMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (value && typeof value === "object") {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) out[key] = parsed;
    }
  }
  return out;
}

export function toRun(value: unknown): RunRecord {
  const r = asRecord(value);
  return {
    id: str(r.id),
    clientKey: str(r.clientKey),
    targetUrl: str(r.targetUrl),
    label: str(r.label),
    concurrency: num(r.concurrency),
    durationSeconds: num(r.durationSeconds),
    status: str(r.status) || "completed",
    total: num(r.total),
    success: num(r.success),
    errors: num(r.errors),
    avgLatency: num(r.avgLatency),
    p95Latency: num(r.p95Latency),
    minLatency: num(r.minLatency),
    maxLatency: num(r.maxLatency),
    rps: num(r.rps),
    proxyLabel: str(r.proxyLabel) || "Direct",
    errorMessage: str(r.errorMessage),
    startedAt: str(r.startedAt),
    finishedAt: str(r.finishedAt),
    created_date: str(r.created_date),
  };
}

export function toBucket(value: unknown): BucketRecord {
  const r = asRecord(value);
  let codes: Record<string, number> = {};
  const raw = r.statusCodes;
  if (typeof raw === "string" && raw.trim()) {
    try {
      codes = toCodeMap(JSON.parse(raw) as unknown);
    } catch {
      codes = {};
    }
  } else if (raw && typeof raw === "object") {
    codes = toCodeMap(raw);
  }
  return {
    id: str(r.id),
    runId: str(r.runId),
    clientKey: str(r.clientKey),
    second: num(r.second),
    requests: num(r.requests),
    errors: num(r.errors),
    avgLatency: num(r.avgLatency),
    statusCodes: codes,
  };
}

export function toTarget(value: unknown): TargetRecord {
  const r = asRecord(value);
  return {
    id: str(r.id),
    label: str(r.label),
    url: str(r.url),
    notes: str(r.notes),
    autoCheck: bool(r.autoCheck),
    lastChecked: str(r.lastChecked),
  };
}

export function toProxy(value: unknown): ProxyRecord {
  const r = asRecord(value);
  return {
    id: str(r.id),
    label: str(r.label),
    host: str(r.host),
    port: num(r.port),
    username: str(r.username),
    lastIp: str(r.lastIp),
    lastCountry: str(r.lastCountry),
    lastIsp: str(r.lastIsp),
    lastCity: str(r.lastCity),
    lastCheckedAt: str(r.lastCheckedAt),
    lastError: str(r.lastError),
  };
}

export function toPreferences(value: unknown): PreferencesRecord {
  const r = asRecord(value);
  return {
    id: str(r.id),
    concurrency: num(r.defaultConcurrency),
    duration: num(r.defaultDuration),
  };
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const pct = value * 100;
  if (pct >= 99.95) return "100%";
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

export function shortHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url || "Unknown site";
  }
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function timeAgo(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const diff = Date.now() - time;
  if (diff < 60_000) return "just now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDateTime(value);
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    default:
      return "Completed";
  }
}

export function runStatusTone(status: string): "primary" | "success" | "destructive" | "muted" {
  switch (status) {
    case "running":
      return "primary";
    case "stopped":
      return "muted";
    case "failed":
      return "destructive";
    default:
      return "success";
  }
}
