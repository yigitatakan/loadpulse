import { createServiceClient, getUser, isAutomation, json } from "@/lib/draftship-server";
import { expandProxyPool, normaliseTargetUrl, runLoadTest } from "@/lib/loadpulse-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHECK_CONCURRENCY = 5;
const CHECK_DURATION_MS = 5000;
const CHECK_TIMEOUT_MS = 8000;
const MIN_GAP_MS = 15 * 60 * 1000;
const MAX_TARGETS_PER_RUN = 3;

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function round(value: number, digits = 1): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export async function POST(req: Request) {
  const automation = await isAutomation(req);
  if (!automation) {
    const user = await getUser(req);
    if (!user) return json({ error: "Sign in first" }, 401);
    const role = (user as unknown as { role?: string }).role;
    if (role !== "admin") return json({ error: "Only the app owner can run checks." }, 403);
  }

  const ds = createServiceClient(req);
  const savedProxy = process.env.PROXY_URL?.trim() || null;
  const savedProxyUrls = savedProxy ? expandProxyPool(savedProxy, 10, 1) : [];

  let targets: unknown[] = [];
  try {
    targets = await ds.entities.Target.filter({ autoCheck: true }, "-created_date");
  } catch {
    return json({ error: "Saved sites could not be loaded." }, 500);
  }

  const now = Date.now();
  const due = targets.map(asRecord).filter((target) => {
    const lastChecked = typeof target.lastChecked === "string" ? Date.parse(target.lastChecked) : 0;
    if (!Number.isFinite(lastChecked) || lastChecked === 0) return true;
    return now - lastChecked > MIN_GAP_MS;
  });

  const checked: Array<{ url: string; total: number; errors: number; avgLatency: number }> = [];

  for (const target of due.slice(0, MAX_TARGETS_PER_RUN)) {
    const targetId = String(target.id ?? "");
    const rawUrl = String(target.url ?? "");
    if (!targetId || !rawUrl) continue;

    let url: string;
    try {
      url = normaliseTargetUrl(rawUrl);
    } catch {
      continue;
    }

    let runId = "";
    try {
      const created = asRecord(
        await ds.entities.TestRun.create({
          clientKey: `schedule_${targetId}_${Date.now()}`,
          targetUrl: url,
          label: String(target.label ?? "") || new URL(url).hostname,
          concurrency: CHECK_CONCURRENCY,
          durationSeconds: CHECK_DURATION_MS / 1000,
          status: "running",
          total: 0,
          success: 0,
          errors: 0,
          avgLatency: 0,
          p95Latency: 0,
          minLatency: 0,
          maxLatency: 0,
          rps: 0,
          proxyLabel: savedProxy
            ? `PROXY_URL · ${Math.max(1, savedProxyUrls.length)} ports`
            : "Direct",
          proxyPorts: savedProxyUrls.length,
          stopRequested: false,
          startedAt: new Date().toISOString(),
        }),
      );
      runId = String(created.id ?? "");
    } catch {
      continue;
    }

    const collected: Array<{
      second: number;
      requests: number;
      errors: number;
      latencySum: number;
      statusCodes: Record<string, number>;
    }> = [];

    try {
      const result = await runLoadTest({
        url,
        concurrency: CHECK_CONCURRENCY,
        durationMs: CHECK_DURATION_MS,
        maxRequests: 500,
        timeoutMs: CHECK_TIMEOUT_MS,
          proxyUrls: savedProxyUrls,
        onBucket: (bucket) => {
          collected.push(bucket);
        },
        onSnapshot: () => {
          /* the scheduled check only needs the final numbers */
        },
      });

      if (runId && collected.length > 0) {
        try {
          await ds.entities.Bucket.bulkCreate(
            collected.map((bucket) => ({
              runId,
              clientKey: `schedule_${targetId}`,
              second: bucket.second,
              requests: bucket.requests,
              errors: bucket.errors,
              avgLatency: bucket.requests > 0 ? round(bucket.latencySum / bucket.requests) : 0,
              statusCodes: JSON.stringify(bucket.statusCodes),
            })),
          );
        } catch {
          /* buckets are a nice-to-have for scheduled checks */
        }
      }

      if (runId) {
        await ds.entities.TestRun.update(runId, {
          total: result.total,
          success: result.success,
          errors: result.errors,
          avgLatency: round(result.avgLatency),
          p95Latency: round(result.p95Latency),
          minLatency: round(result.minLatency),
          maxLatency: round(result.maxLatency),
          rps: round(result.rps, 2),
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      checked.push({
        url,
        total: result.total,
        errors: result.errors,
        avgLatency: round(result.avgLatency),
      });
    } catch (err) {
      if (runId) {
        try {
          await ds.entities.TestRun.update(runId, {
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "The scheduled check failed",
            finishedAt: new Date().toISOString(),
          });
        } catch {
          /* nothing more to do */
        }
      }
    } finally {
      try {
        await ds.entities.Target.update(targetId, { lastChecked: new Date().toISOString() });
      } catch {
        /* the next schedule tries again */
      }
    }
  }

  return json({ checked: checked.length, results: checked });
}
