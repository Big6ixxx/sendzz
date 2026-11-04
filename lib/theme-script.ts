/**
 * The pieces of light and dark mode the server needs: the storage key, the browser bar colours,
 * and the script that sets the mode before first paint. Kept out of lib/theme.ts, a client
 * module, so the root layout receives the script as a string. See lib/theme.ts.
 */

export type Theme = "light" | "dark";

export const THEME_KEY = "sendzz-theme";

/** The browser bar, matching the page: cream, or the dark page colour. */
export const THEME_BAR: Record<Theme, string> = { light: "#f6f2e9", dark: "#0c120e" };

/** Runs before first paint. Tiny and dependency free; any failure leaves the light page. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"${THEME_BAR.dark}":"${THEME_BAR.light}")}catch(e){}})();`;
