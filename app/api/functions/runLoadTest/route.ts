import { createServiceClient, getUser, json } from "@/lib/draftship-server";
import {
  buildProxyUrl,
  describeProxyPool,
  expandProxyPool,
  normaliseTargetUrl,
  runLoadTest,
  type EngineSnapshot,
  type SecondBucket,
} from "@/lib/loadpulse-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hard ceilings. Every signed-in member stays inside them. */
export const MAX_CONCURRENCY = 300;
export const MIN_CONCURRENCY = 1;
export const MAX_DURATION = 45;
export const MIN_DURATION = 3;
export const MAX_REQUESTS = 400_000;
export const MAX_POOL_PORTS = 50;
export const REQUEST_TIMEOUT_MS = 12_000;

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function round(value: number, digits = 1): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function labelForPool(baseLabel: string, portStart: number, portEnd: number, size: number): string {
  if (size <= 1) return baseLabel;
  return `${baseLabel} · ${size} ports (${portStart}–${portEnd})`;
}

function emailOf(user: { email?: string }): string {
  return String(user.email ?? "").toLowerCase();
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const role = (user as unknown as { role?: string }).role;
  const isAdmin = role === "admin";
  const callerEmail = emailOf(user as { email?: string });

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(await req.json());
  } catch {
    return json({ error: "The request body could not be read." }, 400);
  }

  const clientKey = typeof payload.clientKey === "string" ? payload.clientKey.slice(0, 80) : "";
  if (!clientKey) return json({ error: "The run is missing its key." }, 400);

  let targetUrl: string;
  try {
    targetUrl = normaliseTargetUrl(String(payload.targetUrl ?? ""));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "That address is not valid." }, 400);
  }

  const concurrency = clamp(payload.concurrency, MIN_CONCURRENCY, MAX_CONCURRENCY, 50);
  const durationSeconds = clamp(payload.durationSeconds, MIN_DURATION, MAX_DURATION, 15);
  const poolSize = clamp(payload.proxyPoolSize, 1, MAX_POOL_PORTS, 10);
  const insecureTls = payload.insecureTls === true;
  const proxyChoice = typeof payload.proxyChoice === "string" ? payload.proxyChoice : "direct";

  const ds = createServiceClient(req);

  // One burst per account at a time keeps the shared container responsive.
  try {
    const running = await ds.entities.TestRun.filter({ status: "running" }, "-created_date");
    const alreadyRunning = running
      .map(asRecord)
      .some((record) => String(record.created_by ?? "").toLowerCase() === callerEmail);
    if (alreadyRunning) {
      return json({ error: "A run is already in progress on your account. Wait for it to finish." }, 429);
    }
  } catch {
    /* if the check itself fails the run still goes ahead */
  }

  let proxyUrls: string[] = [];
  let proxyBaseLabel = "Direct";
  let baseUrl: string | null = null;

  try {
    if (proxyChoice === "saved") {
      if (!isAdmin) {
        return json(
          { error: "The shared proxy pool belongs to the app owner. Save your own proxy on the Proxies page." },
          403,
        );
      }
      const saved = process.env.PROXY_URL?.trim();
      if (!saved) {
        return json(
          {
            error:
              "No saved proxy URL is configured. Add the PROXY_URL secret, or create a proxy on the Proxies page.",
          },
          400,
        );
      }
      baseUrl = saved;
      proxyBaseLabel = "PROXY_URL";
    } else if (proxyChoice !== "direct" && proxyChoice !== "none" && proxyChoice.length > 0) {
      const proxyRecord = asRecord(await ds.entities.Proxy.get(proxyChoice));
      const owner = String(proxyRecord.created_by ?? "").toLowerCase();
      if (owner !== callerEmail) {
        return json({ error: "That proxy belongs to another account." }, 403);
      }
      const host = String(proxyRecord.host ?? "");
      const port = Number(proxyRecord.port ?? 0);
      if (!host || !Number.isFinite(port) || port <= 0) {
        return json({ error: "That proxy is missing its host or port." }, 400);
      }
      const secrets = await ds.entities.ProxySecret.filter({ proxyId: proxyChoice });
      const password = secrets.length > 0 ? String(asRecord(secrets[0]).password ?? "") : "";
      baseUrl = buildProxyUrl(host, port, String(proxyRecord.username ?? ""), password);
      proxyBaseLabel = String(proxyRecord.label ?? "") || `${host}:${port}`;
    }
  } catch {
    return json({ error: "That proxy could not be loaded. Check it on the Proxies page." }, 400);
  }

  if (baseUrl) {
    proxyUrls = expandProxyPool(baseUrl, poolSize, 1);
    if (proxyUrls.length === 0) {
      return json({ error: "That proxy URL could not be read. Check the host and port." }, 400);
    }
  }

  const pool = baseUrl ? describeProxyPool(baseUrl, poolSize, 1) : null;
  const proxyLabel =
    proxyUrls.length > 0 && pool
      ? labelForPool(proxyBaseLabel, pool.portStart, pool.portEnd, pool.ports.length)
      : "Direct";

  let runId = "";
  try {
    const created = asRecord(
      await ds.entities.TestRun.create({
        clientKey,
        targetUrl,
        label: new URL(targetUrl).hostname,
        concurrency,
        durationSeconds,
        status: "running",
        total: 0,
        success: 0,
        errors: 0,
        avgLatency: 0,
        p95Latency: 0,
        minLatency: 0,
        maxLatency: 0,
        rps: 0,
        proxyLabel,
        proxyPorts: pool ? pool.ports.length : 0,
        stopRequested: false,
        startedAt: new Date().toISOString(),
      }),
    );
    runId = String(created.id ?? "");
    if (!runId) return json({ error: "The run record could not be created." }, 500);

    const owner = String(created.created_by ?? "").toLowerCase();
    if (owner && owner !== callerEmail) {
      try {
        await ds.entities.TestRun.delete(runId);
      } catch {
        /* nothing else to clean up */
      }
      return json({ error: "The run could not be attached to your account." }, 403);
    }
  } catch {
    return json({ error: "The run record could not be created." }, 500);
  }

  const queue: SecondBucket[] = [];
  let latest: EngineSnapshot | null = null;
  let finished = false;

  const flush = async () => {
    if (queue.length > 0) {
      const batch = queue.splice(0, queue.length);
      try {
        await ds.entities.Bucket.bulkCreate(
          batch.map((bucket) => ({
            runId,
            clientKey,
            second: bucket.second,
            requests: bucket.requests,
            errors: bucket.errors,
            avgLatency: bucket.requests > 0 ? round(bucket.latencySum / bucket.requests) : 0,
            statusCodes: JSON.stringify(bucket.statusCodes),
          })),
        );
      } catch {
        /* a missing second should not stop the run */
      }
    }

    if (latest) {
      const snapshot = latest;
      try {
        await ds.entities.TestRun.update(runId, {
          total: snapshot.total,
          success: snapshot.success,
          errors: snapshot.errors,
          avgLatency: round(snapshot.avgLatency),
          p95Latency: round(snapshot.p95Latency),
          minLatency: round(snapshot.minLatency),
          maxLatency: round(snapshot.maxLatency),
          rps: round(snapshot.rps, 2),
        });
      } catch {
        /* the next tick tries again */
      }
    }
  };

  const writer = (async () => {
    for (;;) {
      await sleep(1000);
      await flush();
      if (finished && queue.length === 0) return;
    }
  })();

  let result: Awaited<ReturnType<typeof runLoadTest>> | null = null;
  let failure: string | null = null;

  try {
    result = await runLoadTest({
      url: targetUrl,
      concurrency,
      durationMs: durationSeconds * 1000,
      maxRequests: MAX_REQUESTS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      proxyUrls,
      insecureTls,
      onBucket: (bucket) => {
        queue.push(bucket);
      },
      onSnapshot: (snapshot) => {
        latest = snapshot;
      },
      shouldStop: async () => {
        try {
          const record = asRecord(await ds.entities.TestRun.get(runId));
          return record.stopRequested === true;
        } catch {
          return false;
        }
      },
    });
  } catch (err) {
    failure = err instanceof Error ? err.message : "The load test failed";
  } finally {
    finished = true;
    await writer;
  }

  try {
    if (result) {
      await ds.entities.TestRun.update(runId, {
        total: result.total,
        success: result.success,
        errors: result.errors,
        avgLatency: round(result.avgLatency),
        p95Latency: round(result.p95Latency),
        minLatency: round(result.minLatency),
        maxLatency: round(result.maxLatency),
        rps: round(result.rps, 2),
        status: result.stopped ? "stopped" : "completed",
        finishedAt: new Date().toISOString(),
      });
    } else {
      await ds.entities.TestRun.update(runId, {
        status: "failed",
        errorMessage: failure ?? "The load test failed",
        finishedAt: new Date().toISOString(),
      });
    }
  } catch {
    return json({ error: "The run finished but its result could not be saved." }, 500);
  }

  if (!result) {
    return json({ error: failure ?? "The load test failed" }, 400);
  }

  return json({
    runId,
    status: result.stopped ? "stopped" : "completed",
    total: result.total,
    errors: result.errors,
    rps: round(result.rps, 2),
    proxyLabel,
    proxyPorts: pool ? pool.ports : [],
  });
}
