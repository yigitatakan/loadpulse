"use client";
/**
 * Draftship translations. Managed by Draftship; do not edit.
 *
 *   const t = useT();  t("nav.home")  t("cart.items", { count: 3 })   // "{count} items"
 *   <LanguageSwitcher />
 *
 * Texts live in messages/<language>.json. Write messages/en.json only: Draftship translates it
 * into the languages listed in draftship/i18n.json on every build.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_LANGUAGE, MESSAGES } from "./draftship-messages";

const LANG_KEY = "draftship_lang";
type Tree = { [key: string]: string | Tree };

export const LANGUAGES: string[] = Object.keys(MESSAGES).length ? Object.keys(MESSAGES) : [DEFAULT_LANGUAGE];

const listeners = new Set<() => void>();

function pick(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGUAGES.includes(saved)) return saved;
  } catch {}
  for (const l of typeof navigator !== "undefined" ? navigator.languages ?? [] : []) {
    const base = l.toLowerCase().split("-")[0];
    const hit = LANGUAGES.find((x) => x.toLowerCase() === l.toLowerCase()) ?? LANGUAGES.find((x) => x.toLowerCase().split("-")[0] === base);
    if (hit) return hit;
  }
  return DEFAULT_LANGUAGE;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LANG_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

function lookup(tree: Tree | undefined, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** The language showing now, the ones the app offers, and a way to switch. */
export function useLanguage() {
  const language = useSyncExternalStore(subscribe, pick, () => DEFAULT_LANGUAGE);
  const setLanguage = (lang: string) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
    document.documentElement.lang = lang;
    listeners.forEach((l) => l());
  };
  return { language, languages: LANGUAGES, setLanguage };
}

/** t("section.key", { name: "Ada" }) fills "{name}" in the text. Falls back to the default language, then the key. */
export function useT() {
  const { language } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => {
    const text = lookup(MESSAGES[language] as Tree, key) ?? lookup(MESSAGES[DEFAULT_LANGUAGE] as Tree, key) ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
  };
}

function nativeName(lang: string) {
  try {
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : lang;
  } catch {
    return lang;
  }
}

/** A compact language menu for the header. Shows nothing when the app has one language. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, languages, setLanguage } = useLanguage();
  if (languages.length < 2) return null;
  return (
    <select
      aria-label="Language"
      value={language}
      onChange={(e) => setLanguage(e.target.value)}
      className={[
        "h-9 rounded-full border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      ].filter(Boolean).join(" ")}
    >
      {languages.map((l) => (
        <option key={l} value={l}>
          {nativeName(l)}
        </option>
      ))}
    </select>
  );
}
