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
        ink: {
          950: "#070b14",
          900: "#0b1220",
          800: "#111a2e",
          700: "#1a2540",
          600: "#26335a",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
