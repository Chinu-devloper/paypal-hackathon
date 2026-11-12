export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "mos-theme";

/** Runs before first paint (inlined in the root layout) so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}var c=document.documentElement.classList;c.remove("light","dark");c.add(t)}catch(e){}`;
