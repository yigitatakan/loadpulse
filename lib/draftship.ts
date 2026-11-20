/**
 * Draftship SDK — the backend for this app: database (entities), user accounts and AI/file
 * integrations. Managed by Draftship; do not edit. Use it from client components only.
 *
 *   import { ds } from "@/lib/draftship";
 *   const tasks = await ds.entities.Task.filter({ done: false }, "-created_date");
 */

const BASE = (process.env.NEXT_PUBLIC_DRAFTSHIP_API || "/_ds").replace(/\/$/, "");
const TOKEN_KEY = "draftship_token";

// Field types come from each app's own entities, which the SDK can't know. They're `any` so app code
// compiles as written, with or without its own types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DsRecord = { id: string; created_date: string; updated_date: string; created_by: string | null; [field: string]: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DsUser = { id: string; email: string; full_name: string | null; role: "user" | "admin"; created_date: string; [field: string]: any };
type Query = Record<string, unknown>;
export type DsAgentMessage = { role: "user" | "assistant"; content: string; tool_calls?: { name: string; args: Record<string, unknown> }[]; created_date?: string };
export type DsConversation = { id: string; agent: string; title: string | null; created_date: string; updated_date: string; messages: DsAgentMessage[] };

export type DsEmailConfig = { receiving: boolean; available: boolean; domain: string | null; app: string | null; public_inboxes: boolean; address_format: string | null };
export type DsInboundEmail = DsRecord & { to: string; mailbox: string; from: string; from_name: string; subject: string; text: string; html: string; received_at: string; attachments: { filename: string; content_type: string; size: number }[] };

export class DraftshipError extends Error {
  /** e.g. "verification_required" (enter the emailed code) or "pending_approval" (private app). */
  code?: string;
  constructor(public status: number, message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

let verificationProof: string | undefined;
type AuthResponse = { access_token?: string; user?: DsUser; verification_proof?: string; verification_required?: boolean; verification_reason?: string; pending_approval?: boolean; email?: string };

function signedIn(r: AuthResponse): DsUser {
  if (r.access_token && r.user) {
    setToken(r.access_token);
    return r.user;
  }
  if (r.verification_proof) verificationProof = r.verification_proof;
  if (r.verification_required) {
    const why = r.verification_reason === "owner" ? " This address belongs to the app's owner, so we check it's really you." : r.verification_reason === "invited" ? " This address was invited, so we check it's really you." : r.verification_reason === "private" ? " This app is private, so every new account confirms its email." : "";
    throw new DraftshipError(202, `We sent a 6-digit code to ${r.email}. Enter it to continue.${why}`, "verification_required");
  }
  if (r.pending_approval) throw new DraftshipError(403, "This app is private. The owner has been asked to let you in.", "pending_approval");
  throw new DraftshipError(500, "Sign-in failed");
}

function token(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {}
  restartLive(); // what a user may see changes with who is signed in
}

// ---------- Realtime: one shared server-sent event stream for all subscriptions on the page ----------

export type DsChangeEvent<T = DsRecord> = { type: "create" | "update" | "delete"; entity: string; id: string; data: T; timestamp: string };
type LiveListener = { entity: string; onEvent: (e: DsChangeEvent) => void; onReady?: () => void };

const live = { listeners: new Set<LiveListener>(), ctrl: null as AbortController | null, token: undefined as string | null | undefined, retry: 0 };

function dispatch(raw: string) {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (event === "ready") live.listeners.forEach((l) => l.onReady?.());
  if (event !== "change" || !data) return;
  try {
    const e = JSON.parse(data) as DsChangeEvent;
    live.listeners.forEach((l) => { if (l.entity === e.entity) l.onEvent(e); });
  } catch {}
}

function ensureLive() {
  if (typeof window === "undefined") return;
  if (!live.listeners.size) {
    live.ctrl?.abort();
    live.ctrl = null;
    return;
  }
  const t = token();
  if (live.ctrl && live.token === t) return;
  live.ctrl?.abort();
  const ctrl = new AbortController();
  live.ctrl = ctrl;
  live.token = t;
  (async () => {
    try {
      const res = await fetch(`${BASE}/realtime`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, signal: ctrl.signal, cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`realtime ${res.status}`);
      live.retry = 0;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          dispatch(buf.slice(0, i));
          buf = buf.slice(i + 2);
        }
      }
    } catch {}
    // Reconnect with backoff unless this stream was replaced or stopped on purpose.
    if (live.ctrl === ctrl && !ctrl.signal.aborted) {
      live.ctrl = null;
      setTimeout(ensureLive, Math.min(30_000, 1000 * 2 ** live.retry++));
    }
  })();
}

function restartLive() {
  live.ctrl?.abort();
  live.ctrl = null;
  ensureLive();
}

function listen(l: LiveListener): () => void {
  live.listeners.add(l);
  ensureLive();
  return () => {
    live.listeners.delete(l);
    ensureLive();
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}/${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new DraftshipError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entity<T = any>(name: string) {
  const path = `entities/${encodeURIComponent(name)}`;
  return {
    /** All records, newest first by default. sort: "-field" for descending. */
    list: (sort?: string, limit?: number, skip?: number) => request<T[]>("GET", `${path}${qs({ sort, limit, skip })}`),
    /** Records matching a MongoDB-style query, e.g. { status: "open", price: { $lt: 10 } }. */
    filter: (query: Query, sort?: string, limit?: number, skip?: number) => request<T[]>("GET", `${path}${qs({ q: query, sort, limit, skip })}`),
    get: (id: string) => request<T>("GET", `${path}/${id}`),
    create: (data: Partial<T>) => request<T>("POST", path, data),
    bulkCreate: (items: Partial<T>[]) => request<T[]>("POST", path, items),
    update: (id: string, data: Partial<T>) => request<T>("PATCH", `${path}/${id}`, data),
    /** Same change to every record matching the query. */
    updateMany: (query: Query, data: Partial<T>) => request<{ updated: number }>("PATCH", `${path}${qs({ q: query })}`, data),
    /** Each item must include its id. */
    bulkUpdate: async (items: (Partial<T> & { id: string })[]) => Promise.all(items.map(({ id, ...data }) => request<T>("PATCH", `${path}/${id}`, data))),
    delete: (id: string) => request<{ deleted: number }>("DELETE", `${path}/${id}`),
    deleteMany: (query: Query) => request<{ deleted: number }>("DELETE", `${path}${qs({ q: query })}`),
    count: async (query?: Query) => (await request<{ count: number }>("GET", `${path}${qs({ q: query, count: 1 })}`)).count,
    /**
     * Live list: calls back with the matching records now and again instantly whenever one is
     * created, changed or deleted (by anyone). Returns an unsubscribe function.
     * The third argument is kept for compatibility and ignored.
     */
    subscribe: (callback: (records: T[]) => void, query?: Query, _legacyIntervalMs?: number) => {
      let last = "";
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const refresh = async () => {
        try {
          const items = await request<T[]>("GET", `${path}${qs({ q: query })}`);
          const sig = JSON.stringify(items);
          if (!stopped && sig !== last) {
            last = sig;
            callback(items);
          }
        } catch {}
      };
      // Bursts of changes (bulk creates) collapse into one refetch.
      const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 120);
      };
      refresh();
      const stop = listen({ entity: name, onEvent: soon, onReady: soon });
      return () => {
        stopped = true;
        clearTimeout(timer);
        stop();
      };
    },
    /** Every change to this entity as it happens: { type: "create" | "update" | "delete", id, data, timestamp }. Returns an unsubscribe function. */
    onChange: (callback: (event: DsChangeEvent<T>) => void) => listen({ entity: name, onEvent: (e) => callback(e as unknown as DsChangeEvent<T>) }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EntityApi = ReturnType<typeof entity<any>>;

export const ds = {
  /** ds.entities.Task.list() — any PascalCase name declared in draftship/entities/. */
  entities: new Proxy({} as Record<string, EntityApi>, { get: (_t, name) => entity(String(name)) }),

  auth: {
    /** Creates an account. Throws DraftshipError with code "verification_required" when the app confirms emails: then call verifyEmail. */
    register: async (input: { email: string; password: string; full_name?: string }) => signedIn(await request<AuthResponse>("POST", "auth/register", input)),
    loginViaEmailPassword: async (email: string, password: string) => signedIn(await request<AuthResponse>("POST", "auth/login", { email, password })),
    /** Finishes sign-up with the 6-digit code from the confirmation email. */
    verifyEmail: async (email: string, code: string) => signedIn(await request<AuthResponse>("POST", "auth/verify", { email, proof: verificationProof, code })),
    resendVerificationCode: (email: string) => request<{ ok: boolean }>("POST", "auth/resend", { email }),
    /** Emails a reset link (always succeeds, so it can't reveal who has an account). */
    requestPasswordReset: (email: string) => request<{ ok: boolean }>("POST", "auth/forgot", { email }),
    resetPassword: async (token: string, password: string) => signedIn(await request<AuthResponse>("POST", "auth/reset", { token, password })),
    /** Sends the visitor to Google or the app's SSO provider, then back to `next`. */
    loginWithProvider: (provider: "google" | "sso", next = typeof window !== "undefined" ? window.location.pathname : "/") => {
      if (typeof window !== "undefined") window.location.href = `${BASE}/auth/${provider}?next=${encodeURIComponent(next)}`;
    },
    /** Opens Draftship's hosted sign-in page (email, Google, SSO, sign-up, password reset). */
    redirectToLogin: (next = typeof window !== "undefined" ? window.location.pathname : "/") => {
      if (typeof window !== "undefined") window.location.href = `${BASE}/login?next=${encodeURIComponent(next)}`;
    },
    /** Which sign-in methods the app offers: { password, google, sso, verify_email, access }. */
    getConfig: () => request<{ app: string; access: "public" | "login" | "private"; password: boolean; verify_email: boolean; google: boolean; sso: string | null }>("GET", "auth/config"),
    /** The signed-in user, or null. */
    me: async () => {
      if (!token()) return null;
      try {
        return await request<DsUser>("GET", "auth/me");
      } catch {
        return null;
      }
    },
    updateMe: (data: Partial<DsUser>) => request<DsUser>("PATCH", "auth/me", data),
    isAuthenticated: async () => !!(await ds.auth.me()),
    logout: async (redirectUrl?: string) => {
      setToken(null);
      await fetch(`${BASE}/auth/logout`, { method: "POST" }).catch(() => {}); // clears the hosted-login cookie
      if (redirectUrl && typeof window !== "undefined") window.location.href = redirectUrl;
    },
  },

  /** Lets the signed-in person link their own accounts, like their Google Calendar. Backend functions then act for them. */
  connectors: {
    /** The services this person can link, and which they have. */
    list: () => request<{ provider: string; label: string; connected: boolean; account: string | null }[]>("GET", "connectors"),
    /** Sends them to the service to approve, then back to `next` with ?connected=<provider> or ?connector_error=<message>. */
    connect: async (provider: string, next = typeof window !== "undefined" ? window.location.pathname : "/") => {
      const { url } = await request<{ url: string }>("POST", `connectors/${encodeURIComponent(provider)}/connect`, { next });
      if (typeof window !== "undefined") window.location.href = url;
    },
    disconnect: (provider: string) => request<{ ok: boolean }>("DELETE", `connectors/${encodeURIComponent(provider)}`),
  },

  /** Calls a backend function: app/api/functions/<name>/route.ts in this app. */
  functions: {
    invoke: async <R = unknown>(name: string, data?: unknown): Promise<R> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const t = token();
      if (t) headers.Authorization = `Bearer ${t}`;
      const res = await fetch(`/api/functions/${encodeURIComponent(name)}`, { method: "POST", headers, body: JSON.stringify(data ?? {}) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new DraftshipError(res.status, (out && out.error) || `Function ${name} failed (${res.status})`);
      return out as R;
    },
  },

  /** In-app AI agents declared in draftship/agents/. */
  agents: {
    list: () => request<{ name: string; description?: string; greeting?: string }[]>("GET", "agents"),
    createConversation: (agentName: string) => request<DsConversation>("POST", `agents/${encodeURIComponent(agentName)}/conversations`),
    /** The signed-in user's conversations with an agent (empty when signed out). */
    listConversations: (agentName: string) => request<Omit<DsConversation, "messages">[]>("GET", `agents/${encodeURIComponent(agentName)}/conversations`),
    getConversation: (conversationId: string) => request<DsConversation>("GET", `conversations/${conversationId}`),
    /** Sends a message and resolves with the agent's reply (it may read or change data first). */
    sendMessage: (conversationId: string, content: string) => request<DsAgentMessage>("POST", `conversations/${conversationId}/messages`, { content }),
  },

  /**
   * Email that arrives for this app (the owner turns receiving on in Dashboard → Email). Mail to
   * <mailbox>.<app>@<domain> is saved in the InboundEmail table: { to, mailbox, from, from_name,
   * subject, text, html, received_at, attachments }. html is untrusted: show it only in
   * <iframe sandbox="" srcDoc={html} />.
   */
  email: {
    /** { receiving, domain, app, public_inboxes, address_format }. */
    config: () => request<DsEmailConfig>("GET", "email/config"),
    /** The full address for a mailbox name, like "misty-fox" → misty-fox.<app>@<domain>. */
    address: async (mailbox: string) => {
      const c = await ds.email.config();
      if (!c.receiving || !c.domain || !c.app) throw new DraftshipError(404, "This app doesn't receive email yet. The owner turns it on in Dashboard → Email.");
      const name = mailbox.toLowerCase().replace(/[^a-z0-9._+-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").slice(0, 64);
      return `${name ? `${name}.` : ""}${c.app}@${c.domain}`;
    },
    /** A new, hard-to-guess address, for temporary inboxes. */
    randomAddress: async () => {
      const words = ["amber", "brisk", "cedar", "dune", "ember", "fern", "glade", "harbor", "iris", "jade", "kelp", "lumen", "maple", "nova", "opal", "pine", "quill", "reef", "sage", "tide", "umber", "vale", "willow", "zephyr"];
      const pick = () => words[Math.floor(Math.random() * words.length)];
      const n = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("");
      return ds.email.address(`${pick()}-${pick()}-${n}`);
    },
    /** Messages sent to an address, newest first. Works for visitors when the owner made inboxes public; otherwise for admins. */
    inbox: (address: string, limit = 50) => request<DsInboundEmail[]>("GET", `email/inbox?address=${encodeURIComponent(address)}&limit=${limit}`),
    /** Calls back with the address's messages now and whenever new ones arrive. Returns a function that stops it. */
    watch: (address: string, callback: (messages: DsInboundEmail[]) => void, intervalMs = 4000) => {
      let stopped = false;
      let last = "";
      const tick = async () => {
        if (stopped) return;
        try {
          const list = await ds.email.inbox(address);
          const key = list.map((m) => m.id).join(",");
          if (key !== last) { last = key; callback(list); }
        } catch {}
        if (!stopped) setTimeout(tick, document.hidden ? intervalMs * 3 : intervalMs);
      };
      void tick();
      return () => { stopped = true; };
    },
  },

  analytics: {
    /** Records a custom event, shown in the app dashboard's Analytics. Never throws. */
    track: async (input: { eventName: string; properties?: Record<string, unknown> }): Promise<void> => {
      await request("POST", "analytics/track", input).catch(() => {});
    },
  },

  integrations: {
    Core: {
      /** Returns text, or a parsed object when response_json_schema is given. */
      InvokeLLM: <R = string>(input: { prompt: string; response_json_schema?: Record<string, unknown> }) => request<R>("POST", "integrations/Core/InvokeLLM", input),
      GenerateImage: (input: { prompt: string }) => request<{ url: string }>("POST", "integrations/Core/GenerateImage", input),
      UploadFile: (input: { file: File | Blob }) => {
        const form = new FormData();
        form.append("file", input.file);
        return request<{ file_url: string }>("POST", "integrations/Core/UploadFile", form);
      },
      SendEmail: (input: { to: string; subject: string; body: string; from_name?: string }) => request<{ success: boolean }>("POST", "integrations/Core/SendEmail", input),
    },
  },
};

export default ds;
