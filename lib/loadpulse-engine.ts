import { Agent, ProxyAgent, request, type Dispatcher } from "undici";

export type SecondBucket = {
  second: number;
  requests: number;
  errors: number;
  latencySum: number;
  statusCodes: Record<string, number>;
};

export type EngineSnapshot = {
  total: number;
  success: number;
  errors: number;
  avgLatency: number;
  p95Latency: number;
  minLatency: number;
  maxLatency: number;
  rps: number;
  elapsedSeconds: number;
  statusCodes: Record<string, number>;
};

export type EngineOptions = {
  url: string;
  concurrency: number;
  durationMs: number;
  maxRequests: number;
  timeoutMs: number;
  /** One or more proxy URLs. Each worker rotates through the list, so every port gives a different exit IP. */
  proxyUrls?: string[];
  /** Skip certificate verification for sites you control that use a self-signed certificate. */
  insecureTls?: boolean;
  onBucket: (bucket: SecondBucket) => void;
  onSnapshot: (snapshot: EngineSnapshot) => void;
  shouldStop?: () => Promise<boolean>;
};

export type EngineResult = EngineSnapshot & {
  stopped: boolean;
  buckets: SecondBucket[];
};

const LATENCY_SAMPLE_LIMIT = 50_000;
const MAX_POOL_SIZE = 50;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 169 && second === 254) return true;
  }
  if (host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))) {
    return true;
  }
  return false;
}

export function normaliseTargetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Enter the address of the site you want to test.");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("That address is not valid. Include the full URL, for example https://example.com.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// addresses can be tested.");
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Local and private network addresses cannot be tested from LoadPulse.");
  }
  parsed.hash = "";
  return parsed.toString();
}

export type ProxyParts = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export type ProxyPoolInfo = {
  host: string;
  username: string;
  portStart: number;
  portEnd: number;
  ports: number[];
};

function clampPoolSize(count: number): number {
  const parsed = Number(count);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(MAX_POOL_SIZE, Math.max(1, Math.round(parsed)));
}

export function parseProxyUrl(raw: string): ProxyParts | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  if (!parsed.hostname || !Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return {
    host: parsed.hostname,
    port,
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
  };
}

export function buildProxyUrl(host: string, port: number, username: string, password: string): string {
  const cleanHost = host.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
  return `http://${auth}${cleanHost}:${port}`;
}

/**
 * Decodo (and most rotating proxy providers) expose a different exit IP on every port.
 * The saved secret holds one port, so the pool is that same host and login with the next ports.
 */
export function expandProxyPool(baseUrl: string, count: number, step = 1): string[] {
  const parts = parseProxyUrl(baseUrl);
  if (!parts) return [];
  const total = clampPoolSize(count);
  const urls: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const port = parts.port + index * step;
    if (port > 65535) break;
    urls.push(buildProxyUrl(parts.host, port, parts.username, parts.password));
  }
  return urls;
}

export function describeProxyPool(baseUrl: string, count: number, step = 1): ProxyPoolInfo | null {
  const parts = parseProxyUrl(baseUrl);
  if (!parts) return null;
  const total = clampPoolSize(count);
  const ports: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const port = parts.port + index * step;
    if (port > 65535) break;
    ports.push(port);
  }
  if (ports.length === 0) return null;
  return {
    host: parts.host,
    username: parts.username,
    portStart: ports[0],
    portEnd: ports[ports.length - 1],
    ports,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export async function runLoadTest(options: EngineOptions): Promise<EngineResult> {
  const { url, durationMs, maxRequests, timeoutMs, insecureTls } = options;
  const proxyUrls = (options.proxyUrls ?? []).map((value) => value.trim()).filter(Boolean);
  const workers = Math.max(1, Math.min(2000, Math.round(options.concurrency)));

  const connect = insecureTls
    ? { rejectUnauthorized: false, timeout: timeoutMs }
    : { timeout: timeoutMs };
  const connectionsPerAgent = Math.min(
    512,
    Math.max(16, Math.ceil(workers / Math.max(1, proxyUrls.length)) + 8),
  );
  const keepAlive = { keepAliveTimeout: 30_000, keepAliveMaxTimeout: 120_000 };

  const dispatchers: Dispatcher[] =
    proxyUrls.length > 0
      ? proxyUrls.map(
          (proxyUrl) =>
            new ProxyAgent({
              uri: proxyUrl,
              connections: connectionsPerAgent,
              ...keepAlive,
              connect,
            }),
        )
      : [new Agent({ connections: connectionsPerAgent, ...keepAlive, connect })];

  let dispatcherIndex = 0;
  const nextDispatcher = (): Dispatcher => {
    if (dispatchers.length === 1) return dispatchers[0];
    dispatcherIndex = (dispatcherIndex + 1) % dispatchers.length;
    return dispatchers[dispatcherIndex];
  };

  const startedAt = Date.now();
  const deadline = startedAt + durationMs;

  let stopped = false;
  let issued = 0;
  let total = 0;
  let success = 0;
  let errors = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let minLatency = Number.POSITIVE_INFINITY;
  let maxLatency = 0;

  const latencies: number[] = [];
  const statusCodes: Record<string, number> = {};
  const pending = new Map<number, SecondBucket>();
  const emitted: SecondBucket[] = [];

  const rememberLatency = (value: number) => {
    latencyCount += 1;
    if (latencies.length < LATENCY_SAMPLE_LIMIT) {
      latencies.push(value);
      return;
    }
    const index = Math.floor(Math.random() * latencyCount);
    if (index < LATENCY_SAMPLE_LIMIT) latencies[index] = value;
  };

  const record = (second: number, latency: number, ok: boolean, code: number) => {
    total += 1;
    if (ok) success += 1;
    else errors += 1;
    latencySum += latency;
    rememberLatency(latency);
    if (latency < minLatency) minLatency = latency;
    if (latency > maxLatency) maxLatency = latency;

    const key = code > 0 ? String(code) : "network";
    statusCodes[key] = (statusCodes[key] ?? 0) + 1;

    const bucket =
      pending.get(second) ?? { second, requests: 0, errors: 0, latencySum: 0, statusCodes: {} };
    bucket.requests += 1;
    if (!ok) bucket.errors += 1;
    bucket.latencySum += latency;
    bucket.statusCodes[key] = (bucket.statusCodes[key] ?? 0) + 1;
    pending.set(second, bucket);
  };

  const snapshot = (): EngineSnapshot => {
    const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
    return {
      total,
      success,
      errors,
      avgLatency: total > 0 ? latencySum / total : 0,
      p95Latency: percentile(latencies, 95),
      minLatency: Number.isFinite(minLatency) ? minLatency : 0,
      maxLatency,
      rps: total / elapsedSeconds,
      elapsedSeconds,
      statusCodes: { ...statusCodes },
    };
  };

  const flushClosedSeconds = () => {
    const currentSecond = Math.floor((Date.now() - startedAt) / 1000);
    for (const [second, bucket] of pending) {
      if (second < currentSecond) {
        pending.delete(second);
        emitted.push(bucket);
        options.onBucket(bucket);
      }
    }
  };

  const ticker = setInterval(() => {
    flushClosedSeconds();
    options.onSnapshot(snapshot());
  }, 1000);

  let stopTimer: ReturnType<typeof setInterval> | null = null;
  if (options.shouldStop) {
    const stopCheck = options.shouldStop;
    stopTimer = setInterval(() => {
      void stopCheck()
        .then((value) => {
          if (value) stopped = true;
        })
        .catch(() => {
          /* a failed stop check should not kill the run */
        });
    }, 900);
  }

  const worker = async () => {
    while (!stopped && Date.now() < deadline) {
      if (issued >= maxRequests) break;
      issued += 1;

      const requestStarted = performance.now();
      let ok = false;
      let code = 0;

      try {
        const response = await request(url, {
          method: "GET",
          dispatcher: nextDispatcher(),
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
          headers: {
            "user-agent": "LoadPulse/1.1 (authorised load test)",
            accept: "*/*",
            "accept-encoding": "gzip, deflate, br",
            "cache-control": "no-cache",
          },
        });
        code = response.statusCode;
        ok = code >= 200 && code < 400;
        try {
          await response.body.dump();
        } catch {
          /* body already closed */
        }
      } catch {
        ok = false;
        code = 0;
      }

      const latency = performance.now() - requestStarted;
      const second = Math.floor((Date.now() - startedAt) / 1000);
      record(second, latency, ok, code);
    }
  };

  try {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } finally {
    clearInterval(ticker);
    if (stopTimer) clearInterval(stopTimer);
    for (const bucket of pending.values()) {
      emitted.push(bucket);
      options.onBucket(bucket);
    }
    pending.clear();
    await Promise.all(
      dispatchers.map(async (dispatcher) => {
        try {
          await dispatcher.close();
        } catch {
          /* nothing left to close */
        }
      }),
    );
  }

  return { ...snapshot(), stopped, buckets: emitted };
}
