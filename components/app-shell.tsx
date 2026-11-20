"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, BarChart3, GitCompareArrows, Globe2, LogOut, Settings2, ShieldAlert } from "lucide-react";
import { AuthScreen, PageLoader, ThemeToggle } from "@/lib/draftship-ui";
import { ds } from "@/lib/draftship";

type OwnerUser = { email?: string; role?: string };

function readUser(value: unknown): OwnerUser | null {
  if (!value) return null;
  const record = value as { email?: string; role?: string };
  return { email: record.email, role: record.role };
}

const NAV = [
  { href: "/", label: "Console", icon: Activity },
  { href: "/history", label: "History", icon: BarChart3 },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/proxies", label: "Proxies", icon: Globe2 },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<OwnerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ds.auth
      .me()
      .then((value) => {
        if (!cancelled) setUser(readUser(value));
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await ds.auth.logout();
      setUser(null);
      router.push("/");
    } finally {
      setSigningOut(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <PageLoader />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        appName="LoadPulse"
        tagline="Send parallel traffic to your own websites and watch latency, errors and throughput arrive in real time."
          highlights={[
            "A private console — only the owner account can open it",
            "Up to 600 parallel connections per burst",
            "Live CPU and RAM of the machine sending the traffic",
            "Every run saved with per-second history",
          ]}
        onSignedIn={(value) => setUser(readUser(value))}
      />
    );
  }

  if (user.role && user.role !== "admin") {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-soft">
          <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">This console is private</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            LoadPulse only opens for the owner account. Sign in with the email that created this app.
          </p>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Activity className="size-5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">LoadPulse</span>
          </Link>

          <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLinks pathname={pathname} />
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Sign out"
              className="grid size-10 place-items-center rounded-xl border border-border/60 bg-card text-muted-foreground transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>

        <div className="border-t border-border/60 md:hidden">
          <nav
            className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-3 py-2"
            aria-label="Main"
          >
            <NavLinks pathname={pathname} />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          <p className="border-t border-border/60 pt-5 text-[12px] leading-relaxed text-muted-foreground">
            LoadPulse only tests sites you own or are authorised to test. A burst is capped at 600 connections, 45
            seconds and 400,000 requests, and the container&apos;s own CPU and RAM are sampled live on the console.
          </p>
        </footer>
    </div>
  );
}
