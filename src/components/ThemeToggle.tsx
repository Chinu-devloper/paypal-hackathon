"use client";

import { Moon, Sun } from "lucide-react";
import { setTheme, useTheme } from "@/client/theme";
import { cn } from "@/shared/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTheme(next, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition duration-200 hover:border-white/30 hover:bg-white/10 hover:text-white active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-pp-sky",
        className,
      )}
    >
      <Sun className={cn("absolute h-[18px] w-[18px] transition-all duration-500", theme === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0")} aria-hidden />
      <Moon className={cn("absolute h-[18px] w-[18px] transition-all duration-500", theme === "dark" ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")} aria-hidden />
    </button>
  );
}
