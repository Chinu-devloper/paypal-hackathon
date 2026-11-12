const colors = require("tailwindcss/colors");
const plugin = require("tailwindcss/plugin");

// Neutral and status palettes resolve through CSS variables; light theme mirrors each shade (300 -> 700), so existing utilities work in both themes.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const FAMILIES = ["slate", "sky", "blue", "emerald", "amber", "red", "violet", "fuchsia", "rose", "cyan"];
const INK = {
  950: ["#070b14", "#eaf0f9"],
  900: ["#0b1220", "#f6f8fc"],
  800: ["#111a2e", "#ffffff"],
  700: ["#1a2540", "#e6edf8"],
  600: ["#26335a", "#cdd8ec"],
};

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const ref = (name) => `rgb(var(${name}) / <alpha-value>)`;
const scale = (family) => Object.fromEntries(SHADES.map((s) => [s, ref(`--c-${family}-${s}`)]));

const themeVars = plugin(({ addBase }) => {
  const dark = { "--c-white": "255 255 255" };
  const light = { "--c-white": "15 23 42" };
  for (const family of FAMILIES) {
    for (const s of SHADES) {
      dark[`--c-${family}-${s}`] = rgb(colors[family][s]);
      light[`--c-${family}-${s}`] = rgb(colors[family][1000 - s]);
    }
  }
  for (const [s, [d, l]] of Object.entries(INK)) {
    dark[`--c-ink-${s}`] = rgb(d);
    light[`--c-ink-${s}`] = rgb(l);
  }
  // .scope-dark pins a subtree (e.g. the agent terminal) to the dark palette in either theme.
  addBase({ ":root, .scope-dark": dark, "html.light": light });
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pp: {
          navy: "#003087",
          blue: "#0070BA",
          sky: "#009CDE",
        },
        white: ref("--c-white"),
        ink: Object.fromEntries(Object.keys(INK).map((s) => [s, ref(`--c-ink-${s}`)])),
        ...Object.fromEntries(FAMILIES.map((f) => [f, scale(f)])),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "scale-in": { from: { opacity: "0", transform: "translateY(10px) scale(0.97)" }, to: { opacity: "1", transform: "translateY(0) scale(1)" } },
        "slide-in-right": { from: { opacity: "0", transform: "translateX(32px)" }, to: { opacity: "1", transform: "translateX(0)" } },
        float: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        "gradient-x": { "0%, 100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
        "ping-slow": { "75%, 100%": { transform: "scale(2.2)", opacity: "0" } },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out both",
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in-right": "slide-in-right 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        float: "float 6s ease-in-out infinite",
        "gradient-x": "gradient-x 8s ease infinite",
        "ping-slow": "ping-slow 2.4s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [themeVars],
};
