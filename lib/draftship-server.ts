/**
 * Draftship server SDK — for backend functions (app/api/functions/<name>/route.ts) only.
 * Managed by Draftship; do not edit. Never import it from client components.
 *
 *   import { createServiceClient, getUser, json } from "@/lib/draftship-server";
 *
 *   export async function POST(req: Request) {
 *     const user = await getUser(req);              // the signed-in app user, or null
 *     const ds = createServiceClient(req);          // admin access to this app's data
 *     const orders = await ds.entities.Order.filter({ status: "open" });
 *     return json({ count: orders.length });
 *   }
 *
 * Connectors (accounts the app owner linked in Dashboard → Connectors):
 *   const res = await ds.connectors.fetch("google_calendar", "/calendars/primary/events");
 * The platform checks who triggered the function. By default only admins and automations can use a
 * connector, and the owner can change that in Dashboard → Connectors. Pass req to createServiceClient.
 */

const API = (process.env.DRAFTSHIP_API_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.DRAFTSHIP_SERVICE_KEY || "";

type Query = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DsRecord = { id: string; created_date: string; updated_date: string; created_by: string | null; [field: string]: any };
export type DsConnectorToken = { provider: string; access_token: string; expires_at: string | null; account: string | null; api_base: string };
export type DsUser = { id: string; email: string; full_name: string | null; role: "user" | "admin"; [field: string]: unknown };

export class DraftshipError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (!API) throw new DraftshipError(500, "DRAFTSHIP_API_URL is not set");
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new DraftshipError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

const qs = (params: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** Who triggered this function, so the platform can decide whether it may use the owner's connectors. */
function callerHeaders(req?: Request): Record<string, string> {
  if (!req) return {};
  if (req.headers.get("x-draftship-service-key") === SERVICE_KEY && SERVICE_KEY !== "") return { "X-Draftship-Automation": "1" };
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  // A cookie goes along with requests from other sites too, so it only counts from the app's own pages.
  const site = req.headers.get("sec-fetch-site");
  const cookie = !site || site === "same-origin" ? req.headers.get("cookie")?.match(/(?:^|;\s*)ds_token=([^;]+)/)?.[1] : undefined;
  const token = bearer || cookie;
  return token ? { "X-Draftship-Caller-Token": token } : {};
}

/** Calls a connected service's API with a token. Relative paths go to that service's API. */
function connectorFetch(t: DsConnectorToken, path: string, init: RequestInit) {
  // This request carries a person's token, so it can't go anywhere but the service's own API.
  const absolute = /^https?:/i.test(path);
  if (absolute && new URL(path).origin !== new URL(t.api_base).origin) throw new Error(`${t.provider} tokens can only be sent to ${new URL(t.api_base).origin}`);
  const url = absolute ? path : `${t.api_base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${t.access_token}`);
  if (t.provider === "notion" && !headers.has("Notion-Version")) headers.set("Notion-Version", "2022-06-28");
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers, cache: "no-store" });
}

/**
 * Client with the app's service key: full read/write access to every record, ignoring security rules.
 * Pass the incoming request so data created during Draftship test runs is cleaned up afterwards.
 */
export function createServiceClient(req?: Request) {
  const testRun = req?.headers.get("x-draftship-test-run");
  const h: Record<string, string> = { "X-Draftship-Service-Key": SERVICE_KEY, ...(testRun ? { "X-Draftship-Test-Run": testRun } : {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entity = <T = any>(name: string) => {
    const path = `entities/${encodeURIComponent(name)}`;
    return {
      list: (sort?: string, limit?: number, skip?: number) => call<T[]>("GET", `${path}${qs({ sort, limit, skip })}`, undefined, h),
      filter: (query: Query, sort?: string, limit?: number, skip?: number) => call<T[]>("GET", `${path}${qs({ q: query, sort, limit, skip })}`, undefined, h),
      get: (id: string) => call<T>("GET", `${path}/${id}`, undefined, h),
      create: (data: Partial<T>) => call<T>("POST", path, data, h),
      bulkCreate: (items: Partial<T>[]) => call<T[]>("POST", path, items, h),
      update: (id: string, data: Partial<T>) => call<T>("PATCH", `${path}/${id}`, data, h),
      updateMany: (query: Query, data: Partial<T>) => call<{ updated: number }>("PATCH", `${path}${qs({ q: query })}`, data, h),
      delete: (id: string) => call<{ deleted: number }>("DELETE", `${path}/${id}`, undefined, h),
      deleteMany: (query: Query) => call<{ deleted: number }>("DELETE", `${path}${qs({ q: query })}`, undefined, h),
      count: async (query?: Query) => (await call<{ count: number }>("GET", `${path}${qs({ q: query, count: 1 })}`, undefined, h)).count,
    };
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entities: new Proxy({} as Record<string, ReturnType<typeof entity<any>>>, { get: (_t, name) => entity(String(name)) }),
    integrations: {
      Core: {
        InvokeLLM: <R = string>(input: { prompt: string; response_json_schema?: Record<string, unknown> }) => call<R>("POST", "integrations/Core/InvokeLLM", input, h),
        GenerateImage: (input: { prompt: string }) => call<{ url: string }>("POST", "integrations/Core/GenerateImage", input, h),
        SendEmail: (input: { to: string; subject: string; body: string; from_name?: string }) => call<{ success: boolean }>("POST", "integrations/Core/SendEmail", input, h),
      },
    },
    connectors: {
      /** A fresh OAuth access token for a connected service (refreshed automatically). */
      getAccessToken: (provider: string) => call<DsConnectorToken>("GET", `connectors/${encodeURIComponent(provider)}/token`, undefined, { ...h, ...callerHeaders(req) }),
      /**
       * Calls the service's API with the owner's token. Relative paths are resolved against the
       * service's API base (e.g. "/calendars/primary/events" for google_calendar). Returns the raw Response.
       */
      fetch: async (provider: string, path: string, init: RequestInit = {}) => connectorFetch(await call<DsConnectorToken>("GET", `connectors/${encodeURIComponent(provider)}/token`, undefined, { ...h, ...callerHeaders(req) }), path, init),
      /**
       * The same, with the account of the person who made this request, not the owner's. They link it
       * in the app with ds.connectors.connect(). Answers 409 if they haven't, and 401 if they're signed out.
       */
      forUser: {
        getAccessToken: (provider: string) => call<DsConnectorToken>("GET", `connectors/${encodeURIComponent(provider)}/user-token`, undefined, { ...h, ...callerHeaders(req) }),
        fetch: async (provider: string, path: string, init: RequestInit = {}) => connectorFetch(await call<DsConnectorToken>("GET", `connectors/${encodeURIComponent(provider)}/user-token`, undefined, { ...h, ...callerHeaders(req) }), path, init),
      },
    },
    users: {
      /** Sets profile fields on a user, including ones that access rules read. Users can't set those themselves. */
      update: (id: string, data: Record<string, unknown>) => call<Record<string, unknown>>("PATCH", `users/${encodeURIComponent(id)}`, data, h),
    },
    /** Writes to the app dashboard's Logs. */
    log: (message: string, level: "info" | "warn" | "error" = "info", data?: Record<string, unknown>) =>
      call("POST", "logs", { message, level, data }, h).catch(() => {}),
  };
}

/** The app user who made the request (from the SDK's Bearer token), or null when signed out. */
export async function getUser(req: Request): Promise<DsUser | null> {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  try {
    return await call<DsUser>("GET", "auth/me", undefined, { Authorization: auth });
  } catch {
    return null;
  }
}

/** True when the request comes from a Draftship automation (scheduled or data-triggered). */
export const isAutomation = (req: Request) => req.headers.get("x-draftship-service-key") === SERVICE_KEY && SERVICE_KEY !== "";

export const json = (data: unknown, status = 200) => Response.json(data, { status });
