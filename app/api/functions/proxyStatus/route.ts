import { getUser, json } from "@/lib/draftship-server";
import { describeProxyPool, expandProxyPool } from "@/lib/loadpulse-engine";

export const dynamic = "force-dynamic";

function clampPool(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, Math.round(parsed)));
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const role = (user as unknown as { role?: string }).role;
  if (role !== "admin") return json({ error: "Only the app owner can read this." }, 403);

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const saved = process.env.PROXY_URL?.trim() ?? "";
  const poolSize = clampPool(payload.poolSize, 10);
  const pool = saved ? describeProxyPool(saved, poolSize, 1) : null;

  return json({
    configured: Boolean(saved),
    host: pool?.host ?? "",
    username: pool?.username ?? "",
    portStart: pool?.portStart ?? 0,
    portEnd: pool?.portEnd ?? 0,
    ports: pool?.ports ?? [],
    urlsBuilt: saved ? expandProxyPool(saved, poolSize, 1).length : 0,
  });
}
