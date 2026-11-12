"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type Theme } from "@/shared/theme";

export type { Theme };

const current = (): Theme => (document.documentElement.classList.contains("light") ? "light" : "dark");

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}

function apply(next: Theme) {
  const cls = document.documentElement.classList;
  cls.remove("light", "dark");
  cls.add(next);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this session.
  }
}

/** Switches theme with a circular reveal from `origin` when the browser supports view transitions. */
export function setTheme(next: Theme, origin?: { x: number; y: number }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }).startViewTransition;
  if (!start || reduced || !origin) {
    apply(next);
    return;
  }
  const radius = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y));
  const transition = start.call(document, () => apply(next));
  void transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
      { duration: 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
}
