"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/cn";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fixed aurora backdrop; publishes scroll position as CSS variables for parallax and the progress bar. */
export function AmbientBackground() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      root.style.setProperty("--scroll-y", String(window.scrollY));
      root.style.setProperty("--scroll-p", String(Math.min(1, window.scrollY / max)));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const blob = (color: string, size: string, pos: CSSProperties, speed: number, delay: string) => (
    <div className="ambient-parallax" style={{ ["--speed" as string]: speed }}>
      <div
        className="ambient-blob"
        style={{ width: size, height: size, background: `radial-gradient(closest-side, var(${color}), transparent)`, animationDelay: delay, ...pos }}
      />
    </div>
  );

  return (
    <>
      <div className="scroll-progress" aria-hidden />
      <div className="ambient" aria-hidden>
        {blob("--aurora-a", "70vmax", { top: "-30vmax", left: "-20vmax" }, -0.12, "0s")}
        {blob("--aurora-b", "60vmax", { top: "10vmax", right: "-25vmax" }, -0.22, "-7s")}
        {blob("--aurora-c", "55vmax", { bottom: "-35vmax", left: "20vw" }, -0.34, "-14s")}
        <div className="ambient-grid" />
      </div>
    </>
  );
}

/** Marks a page section; the aurora palette follows whichever scene crosses the middle of the viewport. */
export function Scene({ name, id, className, children }: { name: string; id?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) document.body.dataset.scene = name;
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [name]);
  return (
    <section ref={ref} id={id} className={className}>
      {children}
    </section>
  );
}

/** Fades and lifts its children into view the first time they scroll on screen. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("reveal", visible && "is-visible", className)} style={{ transitionDelay: visible ? `${delay}ms` : undefined }}>
      {children}
    </div>
  );
}

/** Eases a number toward `value` whenever it changes. */
export function useCountUp(value: number, duration = 900): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = origin + (value - origin) * eased;
      from.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

/** True once the page has scrolled past `threshold` pixels. */
export function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}
