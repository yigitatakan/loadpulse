import { ProxyAgent, fetch as undiciFetch } from "undici";
import { createServiceClient, getUser, json } from "@/lib/draftship-server";
import { describeProxyPool } from "@/lib/loadpulse-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type IpInfoResponse = {
  proxy?: { ip?: string };
  country?: { name?: string; code?: string };
  isp?: { isp?: string; organization?: string };
  city?: { name?: string };
};

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function buildProxyUrl(host: string, port: number, username: string, password: string): string {
  const cleanHost = host.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
  return `http://${auth}${cleanHost}:${port}`;
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const role = (user as unknown as { role?: string }).role;
  const callerEmail = String(user.email ?? "").toLowerCase();

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(await req.json());
  } catch {
    return json({ error: "The request body could not be read." }, 400);
  }

  const proxyId = typeof payload.proxyId === "string" ? payload.proxyId : "";
  const ds = createServiceClient(req);

  let proxyUrl: string;
  let savedId = "";

  if (!proxyId) {
    // Nothing saved yet: check the address from the form without storing it.
    if (role !== "admin") {
      return json({ error: "Save the proxy first, then press Test." }, 400);
    }
    const host = typeof payload.host === "string" ? payload.host.trim() : "";
    const port = Number(payload.port);
    const username = typeof payload.username === "string" ? payload.username : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!host || !Number.isFinite(port) || port <= 0) {
      return json({ error: "Enter the proxy host and port first." }, 400);
    }
    proxyUrl = buildProxyUrl(host, port, username, password);
  } else {
    try {
      const proxy = asRecord(await ds.entities.Proxy.get(proxyId));
      const owner = String(proxy.created_by ?? "").toLowerCase();
      if (owner !== callerEmail) {
        return json({ error: "That proxy belongs to another account." }, 403);
      }
      const host = String(proxy.host ?? "");
      const port = Number(proxy.port ?? 0);
      if (!host || !Number.isFinite(port) || port <= 0) {
        return json({ error: "This proxy is missing its host or port." }, 400);
      }
      const secrets = await ds.entities.ProxySecret.filter({ proxyId });
      const password = secrets.length > 0 ? String(asRecord(secrets[0]).password ?? "") : "";
      proxyUrl = buildProxyUrl(host, port, String(proxy.username ?? ""), password);
      savedId = proxyId;
    } catch {
      return json({ error: "That proxy could not be loaded." }, 400);
    }
  }

  const agent = new ProxyAgent(proxyUrl);

  try {
    const response = await undiciFetch("https://ip.decodo.com/json?provider=IPinfo", {
      method: "GET",
      dispatcher: agent,
      signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      const message = `The IP check answered with status ${response.status}.`;
      if (savedId) {
        try {
          await ds.entities.Proxy.update(savedId, { lastError: message, lastCheckedAt: new Date().toISOString() });
        } catch {
          /* keep the original error */
        }
      }
      return json({ error: message }, 400);
    }

    const raw = (await response.json()) as IpInfoResponse;
    const ip = typeof raw.proxy?.ip === "string" ? raw.proxy.ip : "";
    const country = typeof raw.country?.name === "string" ? raw.country.name : "";
    const isp = typeof raw.isp?.isp === "string" ? raw.isp.isp : String(raw.isp?.organization ?? "");
    const city = typeof raw.city?.name === "string" ? raw.city.name : "";

    if (!ip) {
      if (savedId) {
        try {
          await ds.entities.Proxy.update(savedId, {
            lastError: "The IP check answered without an exit IP.",
            lastCheckedAt: new Date().toISOString(),
          });
        } catch {
          /* keep the original error */
        }
      }
      return json({ error: "The IP check answered without an exit IP." }, 400);
    }

    if (savedId) {
      try {
        await ds.entities.Proxy.update(savedId, {
          lastIp: ip,
          lastCountry: country,
          lastIsp: isp,
          lastCity: city,
          lastCheckedAt: new Date().toISOString(),
          lastError: "",
        });
      } catch {
        /* the check still succeeded */
      }
    }

    return json({ ip, country, isp, city });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The proxy did not answer";
    if (savedId) {
      try {
        await ds.entities.Proxy.update(savedId, { lastError: message, lastCheckedAt: new Date().toISOString() });
      } catch {
        /* keep the original error */
      }
    }
    return json({ error: `The proxy did not answer: ${message}` }, 400);
  } finally {
    try {
      await agent.close();
    } catch {
      /* nothing to close */
    }
  }
}

/** The owner's shared pool, shown with the login masked. */
export async function GET(req: Request) {
  const user = await getUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);
  const role = (user as unknown as { role?: string }).role;
  if (role !== "admin") return json({ configured: false });

  const saved = process.env.PROXY_URL?.trim() ?? "";
  if (!saved) return json({ configured: false });
  const pool = describeProxyPool(saved, 1, 1);
  if (!pool) return json({ configured: false });
  return json({
    configured: true,
    host: pool.host,
    portStart: pool.portStart,
    loginMasked: pool.username ? `${pool.username.slice(0, 3)}••••` : "",
  });
}
