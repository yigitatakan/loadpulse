"use client";
/**
 * Draftship UI — the parts every app shares. Managed by Draftship; do not edit.
 *
 *   <DraftshipRoot />            first thing inside <body> in app/layout.tsx: theme, page-change
 *                                spinner and toasts (Draftship adds it if it's missing)
 *   <ThemeToggle />              light/dark switch for the header
 *   <AuthScreen appName="…" />   the sign-in and sign-up screen
 *   <PageLoader /> <Spinner />   while data loads
 *   toast.success("Saved")       short feedback after an action
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Check, CircleAlert, CircleCheck, Eye, EyeOff, Info, LoaderCircle, Moon, Sun, X } from "lucide-react";
import { ds, DraftshipError, type DsUser } from "./draftship";
import { useT } from "./draftship-i18n";
import TEXTS from "./draftship-texts.json";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Theme ----------

const THEME_KEY = "draftship_theme";
export type ThemeChoice = "light" | "dark" | "system";

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

/** Sets the theme before the page paints, so it never flashes the wrong colors. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

const themeListeners = new Set<() => void>();
function readChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}
const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  root.classList.add("ds-theme-switching");
  root.classList.toggle("dark", choice === "dark" || (choice === "system" && systemDark()));
  window.setTimeout(() => root.classList.remove("ds-theme-switching"), 0);
}
function subscribeTheme(fn: () => void) {
  themeListeners.add(fn);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (readChoice() === "system") applyTheme("system");
    fn();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      applyTheme(readChoice());
      fn();
    }
  };
  media.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    themeListeners.delete(fn);
    media.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}
const themeSnapshot = () => `${readChoice()}:${document.documentElement.classList.contains("dark") ? "dark" : "light"}`;

/** The chosen theme ("system" follows the device) and the one showing now. */
export function useTheme() {
  const snap = useSyncExternalStore(subscribeTheme, themeSnapshot, () => "system:light");
  const [theme, resolved] = snap.split(":") as [ThemeChoice, "light" | "dark"];
  const setTheme = (choice: ThemeChoice) => {
    try {
      if (choice === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch {}
    applyTheme(choice);
    themeListeners.forEach((l) => l());
  };
  return { theme, resolvedTheme: resolved, setTheme };
}

/** A button that switches between light and dark. Put it in the header (and the mobile menu). */
export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Switch between light and dark mode"
      title="Light or dark mode"
      onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Sun className="size-4 dark:hidden" aria-hidden />
      <Moon className="hidden size-4 dark:block" aria-hidden />
    </button>
  );
}

// ---------- Loading ----------

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cx("inline-flex", className)}>
      <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
    </span>
  );
}

/** A centered spinner for a page or section whose data is still loading. */
export function PageLoader({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={cx("flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 text-muted-foreground", className)} aria-busy="true">
      <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

// ---------- Page changes ----------

/** Links Draftship serves itself (sign-in pages, files, functions) must load as real pages. */
const SERVER_PATH = /^\/(_ds|api|_next)\/|\.(pdf|zip|csv|xlsx?|docx?|png|jpe?g|gif|webp|svg|txt|json|xml|ics|mp3|mp4)$/i;

function internalLink(e: MouseEvent): URL | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || !a.href || a.hasAttribute("download") || a.dataset.reload !== undefined) return null;
  if (a.target && a.target !== "_self") return null;
  if ((a.getAttribute("rel") ?? "").includes("external")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || SERVER_PATH.test(url.pathname)) return null;
  // Only a hash change: the browser scrolls, nothing loads.
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url;
}

/**
 * Shows a bar and a spinner while the next page opens, and turns plain <a href="/…"> links into
 * in-app navigation, so moving between pages never reloads the app.
 */
export function NavigationProgress() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);
  // The address the click left from: the new page is on screen once the address changes.
  const from = useRef<string | null>(null);

  useEffect(() => {
    let showTimer = 0;
    let failsafe = 0;
    const done = () => {
      from.current = null;
      window.clearTimeout(showTimer);
      window.clearTimeout(failsafe);
      setPending(false);
      setVisible(false);
    };
    const start = () => {
      from.current = location.pathname + location.search;
      setPending(true);
      window.clearTimeout(showTimer);
      window.clearTimeout(failsafe);
      // Pages that open instantly shouldn't flash a spinner.
      showTimer = window.setTimeout(() => setVisible(true), 120);
      failsafe = window.setTimeout(done, 15_000);
    };
    const onCapture = (e: MouseEvent) => {
      const url = internalLink(e);
      if (url) start();
    };
    const onBubble = (e: MouseEvent) => {
      if (e.defaultPrevented) return; // a Next.js <Link> already handles it
      const url = internalLink(e);
      if (!url) return;
      e.preventDefault();
      router.push(url.pathname + url.search + url.hash);
    };
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    const changed = () => {
      if (from.current !== null && location.pathname + location.search !== from.current) done();
    };
    history.pushState = function (...args: Parameters<History["pushState"]>) {
      origPush.apply(this, args);
      changed();
    };
    history.replaceState = function (...args: Parameters<History["replaceState"]>) {
      origReplace.apply(this, args);
      changed();
    };
    window.addEventListener("popstate", done);
    document.addEventListener("click", onCapture, true);
    document.addEventListener("click", onBubble);
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("popstate", done);
      document.removeEventListener("click", onCapture, true);
      document.removeEventListener("click", onBubble);
      window.clearTimeout(showTimer);
      window.clearTimeout(failsafe);
    };
  }, [router]);

  if (!pending || !visible) return null;
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-primary/15" aria-hidden>
        <div className="h-full w-2/5 bg-primary" style={{ animation: "ds-progress 1s ease-in-out infinite" }} />
      </div>
      <div className="pointer-events-none fixed left-1/2 top-3 z-[100] -translate-x-1/2 rounded-full border border-border bg-card/95 p-2 shadow-lg backdrop-blur">
        <Spinner label="Opening page" />
      </div>
    </>
  );
}

// ---------- Toasts ----------

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string };
let toasts: ToastItem[] = [];
let nextToast = 1;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}
function push(kind: ToastKind, text: string) {
  const id = nextToast++;
  toasts = [...toasts.slice(-3), { id, kind, text }];
  emitToasts();
  if (typeof window !== "undefined") window.setTimeout(() => dismiss(id), kind === "error" ? 6000 : 4000);
}

/** Short feedback after an action: toast.success("Saved"), toast.error(err.message), toast("Copied"). */
export const toast = Object.assign((text: string) => push("info", text), {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text),
});

const EMPTY: ToastItem[] = [];
export function Toaster() {
  const items = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => {
        toastListeners.delete(fn);
      };
    },
    () => toasts,
    () => EMPTY,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[110] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
        >
          {t.kind === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : t.kind === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
          <p className="flex-1 leading-snug">{t.text}</p>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Goes first inside <body>: the theme, the page-change spinner and toasts. */
/**
 * Apple's system font (San Francisco) on Apple devices; Inter, the closest match, everywhere else.
 * The font file only downloads where Inter is actually used.
 */
export function AppFont() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..800&display=swap" precedence="default" />
    </>
  );
}

export function DraftshipRoot() {
  return (
    <>
      <ThemeScript />
      <AppFont />
      <NavigationProgress />
      <Toaster />
    </>
  );
}

// ---------- Sign-in ----------

/** Pages that exist only to sign in or sign up. */
const AUTH_PAGE = /^\/(sign-?in|sign-?up|log-?in|register|auth|account\/(sign-?in|log-?in))\/?$/i;

type AuthMode = "signin" | "signup" | "verify" | "forgot" | "pending";
type AuthConfig = Awaited<ReturnType<typeof ds.auth.getConfig>>;

export type AuthScreenProps = {
  appName: string;
  /** One line under the name on the brand side. */
  tagline?: string;
  /** Up to four short reasons to sign up, shown with check marks. */
  highlights?: string[];
  /** Opens on sign-up instead of sign-in. */
  initialMode?: "signin" | "signup";
  /** Called once the person is signed in. Without it, the page reloads at `redirectTo` (or here). */
  onSignedIn?: (user: DsUser) => void;
  redirectTo?: string;
  /** Replaces the brand side's content, for an illustration or a quote. */
  aside?: ReactNode;
};

const field =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/70 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring";
const primaryBtn =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const secondaryBtn =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const linkBtn = "font-medium text-primary underline-offset-4 hover:underline";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * The sign-in and sign-up screen: the app's brand on one half, the form on the other (stacked on
 * phones). Handles email codes, password reset, Google and SSO, and private apps.
 */
export function AuthScreen({ appName, tagline, highlights = [], initialMode = "signin", onSignedIn, redirectTo, aside }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // The app's own translations when it has them (Draftship adds these texts to each language).
  const t = useT();
  const s = (key: keyof typeof TEXTS.auth, vars: Record<string, string> = {}) => {
    const own = t(`auth.${key}`, vars);
    return own !== `auth.${key}` ? own : TEXTS.auth[key].replace(/\{(\w+)\}/g, (m, n: string) => vars[n] ?? m);
  };

  // Where to go once signed in: a page that only signs people in sends them home.
  const afterSignIn = () => redirectTo ?? (AUTH_PAGE.test(window.location.pathname) ? "/" : window.location.pathname + window.location.search);

  useEffect(() => {
    ds.auth.getConfig().then(setConfig, () => setConfig(null));
    // Back from Google or SSO, or already signed in on another tab: go on instead of asking again.
    let active = true;
    ds.auth.me().then((user) => {
      if (!active || !user) return;
      if (onSignedIn) onSignedIn(user);
      else if (redirectTo || AUTH_PAGE.test(window.location.pathname)) window.location.replace(afterSignIn());
    }, () => {});
    return () => {
      active = false;
    };
    // Only on arrival: the callbacks may change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (m: AuthMode) => {
    setMode(m);
    setMessage(null);
  };
  const finish = (user: DsUser) => {
    if (onSignedIn) onSignedIn(user);
    else window.location.assign(afterSignIn());
  };
  const fail = (err: unknown) => {
    if (err instanceof DraftshipError && err.code === "verification_required") {
      setMode("verify");
      setMessage({ error: false, text: err.message });
    } else if (err instanceof DraftshipError && err.code === "pending_approval") {
      go("pending");
    } else {
      setMessage({ error: true, text: err instanceof Error ? err.message : s("error") });
    }
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => String(data.get(k) ?? "").trim();
    if (data.has("email")) setEmail(value("email"));
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "signin") finish(await ds.auth.loginViaEmailPassword(value("email"), String(data.get("password") ?? "")));
      else if (mode === "signup") finish(await ds.auth.register({ email: value("email"), password: String(data.get("password") ?? ""), full_name: value("full_name") || undefined }));
      else if (mode === "verify") finish(await ds.auth.verifyEmail(email, value("code")));
      else if (mode === "forgot") {
        await ds.auth.requestPasswordReset(value("email"));
        setMessage({ error: false, text: s("linkSent", { email: value("email") }) });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const password = config?.password !== false;
  const providers = (
    <>
      {config?.google && (
        <button type="button" className={secondaryBtn} onClick={() => ds.auth.loginWithProvider("google", afterSignIn())}>
          <GoogleMark /> {s("google")}
        </button>
      )}
      {config?.sso && (
        <button type="button" className={secondaryBtn} onClick={() => ds.auth.loginWithProvider("sso", afterSignIn())}>
          {s("sso", { provider: config.sso })}
        </button>
      )}
      {(config?.google || config?.sso) && password && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> {s("or")} <span className="h-px flex-1 bg-border" />
        </div>
      )}
    </>
  );

  const heading: Record<AuthMode, [string, string]> = {
    signin: [s("signinTitle"), config?.access === "private" ? s("privateSub") : s("signinSub", { app: appName })],
    signup: [s("signupTitle"), s("signupSub", { app: appName })],
    verify: [s("verifyTitle"), s("verifySub", { email })],
    forgot: [s("forgotTitle"), s("forgotSub")],
    pending: [s("pendingTitle"), s("pendingSub")],
  };

  return (
    <div className="grid min-h-screen w-full bg-background text-foreground lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex dark:bg-[color-mix(in_oklab,var(--primary)_32%,var(--card))] dark:text-foreground">
        <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -right-16 size-[28rem] rounded-full bg-black/10 blur-3xl" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)", backgroundSize: "22px 22px" }}
          aria-hidden
        />
        <div className="relative z-10 flex w-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3 text-lg font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center rounded-xl bg-white/15 text-base font-bold">{appName.slice(0, 1).toUpperCase()}</span>
            {appName}
          </div>
          {aside ?? (
            <div className="max-w-md">
              <p className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">{tagline ?? s("everything")}</p>
              {highlights.length > 0 && (
                <ul className="mt-10 space-y-4">
                  {highlights.slice(0, 4).map((h) => (
                    <li key={h} className="flex items-start gap-3 text-base opacity-90">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/15">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                      {h}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-sm opacity-70">© {new Date().getFullYear()} {appName}</p>
        </div>
      </aside>

      <main className="relative flex items-center justify-center px-5 py-12 sm:px-8">
        <ThemeToggle className="absolute right-5 top-5" />
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 text-base font-semibold lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">{appName.slice(0, 1).toUpperCase()}</span>
            {appName}
          </div>
          {(mode === "verify" || mode === "forgot" || mode === "pending") && (
            <button type="button" onClick={() => go("signin")} className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" aria-hidden /> {s("back")}
            </button>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{heading[mode][0]}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{heading[mode][1]}</p>

          {mode !== "pending" && (
            <form onSubmit={submit} className="mt-8 space-y-4" noValidate={false}>
              {(mode === "signin" || mode === "signup") && providers}
              {mode === "signup" && password && (
                <div className="space-y-1.5">
                  <label htmlFor="ds-name" className="text-sm font-medium">{s("fullName")}</label>
                  <input id="ds-name" name="full_name" autoComplete="name" className={field} placeholder="Jane Cooper" />
                </div>
              )}
              {(mode === "forgot" || ((mode === "signin" || mode === "signup") && password)) && (
                <div className="space-y-1.5">
                  <label htmlFor="ds-email" className="text-sm font-medium">{s("email")}</label>
                  <input id="ds-email" name="email" type="email" required autoComplete="email" defaultValue={email} className={field} placeholder="you@example.com" />
                </div>
              )}
              {(mode === "signin" || mode === "signup") && password && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="ds-password" className="text-sm font-medium">{s("password")}</label>
                    {mode === "signin" && (
                      <button type="button" onClick={() => go("forgot")} className={cx(linkBtn, "text-xs")}>{s("forgot")}</button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="ds-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={mode === "signup" ? 8 : 1}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      className={cx(field, "pr-11")}
                      placeholder={mode === "signup" ? s("newPassword") : s("yourPassword")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? s("hidePassword") : s("showPassword")}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                </div>
              )}
              {mode === "verify" && (
                <div className="space-y-1.5">
                  <label htmlFor="ds-code" className="text-sm font-medium">{s("code")}</label>
                  <input id="ds-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className={cx(field, "text-center font-mono text-xl tracking-[0.5em]")} />
                </div>
              )}

              {message && (
                <div role={message.error ? "alert" : "status"} className={cx("flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm", message.error ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
                  {message.error ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />}
                  <span>{message.text}</span>
                </div>
              )}

              {(password || mode === "verify" || mode === "forgot") && (
                <button type="submit" disabled={busy} className={primaryBtn}>
                  {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                  {mode === "signin" ? s("signIn") : mode === "signup" ? s("createAccount") : mode === "verify" ? s("confirm") : s("sendLink")}
                </button>
              )}
            </form>
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" && password && (
              <>{s("newHere")} <button type="button" onClick={() => go("signup")} className={linkBtn}>{s("createLink")}</button></>
            )}
            {mode === "signup" && (
              <>{s("haveAccount")} <button type="button" onClick={() => go("signin")} className={linkBtn}>{s("signIn")}</button></>
            )}
            {mode === "verify" && (
              <button
                type="button"
                className={linkBtn}
                onClick={async () => {
                  try {
                    await ds.auth.resendVerificationCode(email);
                    setMessage({ error: false, text: s("resent") });
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                {s("resend")}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
