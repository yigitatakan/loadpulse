import { createServiceClient, getUser, json } from "@/lib/draftship-server";
import { describeProxyPool, expandProxyPool } from "@/lib/loadpulse-engine";

export const dynamic = "force-dynamic";

function clampPool(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, Math.round(parsed)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const role = (user as unknown as { role?: string }).role;
  const callerEmail = String(user.email ?? "").toLowerCase();

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const poolSize = clampPool(payload.poolSize, 10);

  // The shared PROXY_URL pool belongs to the app owner only.
  const saved = role === "admin" ? process.env.PROXY_URL?.trim() ?? "" : "";
  const pool = saved ? describeProxyPool(saved, poolSize, 1) : null;

  // Members see a summary of their own saved proxies instead.
  let ownProxies: Array<{ label: string; host: string; port: number; checked: boolean }> = [];
  try {
    const ds = createServiceClient(req);
    const records = await ds.entities.Proxy.list("-created_date", 100);
    ownProxies = records
      .map(asRecord)
      .filter((record) => String(record.created_by ?? "").toLowerCase() === callerEmail)
      .map((record) => ({
        label: String(record.label ?? ""),
        host: String(record.host ?? ""),
        port: Number(record.port ?? 0),
        checked: Boolean(record.lastCheckedAt),
      }));
  } catch {
    ownProxies = [];
  }

  return json({
    configured: Boolean(saved),
    host: pool?.host ?? "",
    username: pool?.username ?? "",
    portStart: pool?.portStart ?? 0,
    portEnd: pool?.portEnd ?? 0,
    ports: pool?.ports ?? [],
    urlsBuilt: saved ? expandProxyPool(saved, poolSize, 1).length : 0,
    ownProxyCount: ownProxies.length,
    ownProxyHosts: ownProxies.slice(0, 5).map((proxy) => `${proxy.host}:${proxy.port}`),
  });
}
