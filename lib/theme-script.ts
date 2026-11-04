/**
 * The pieces of light and dark mode the server needs: the storage key, the browser bar colours,
 * and the script that runs in <head> before first paint. Kept out of lib/theme.ts, a client
 * module, so the root layout receives the script as a string. See lib/theme.ts.
 */

export type Theme = "light" | "dark";

export const THEME_KEY = "sendzz-theme";
/** Fired on window whenever the mode on screen changes. */
export const THEME_EVENT = "sendzz-theme";

/** The browser bar, matching the page: cream, or the dark page colour. */
export const THEME_BAR: Record<Theme, string> = { light: "#f6f2e9", dark: "#0c120e" };

/**
 * Sets the mode before anything paints, so a saved choice never flashes the other one, and stays
 * on every page to follow the device (while nothing is saved) and other tabs. It also owns the
 * two browser-chrome tags, theme-color and the iOS status bar style: React does not render them,
 * so hydration never sees one the script has changed and adds a stale copy beside it. It exposes
 * the one function that applies a chosen mode, `window.__sendzzTheme`, registered before anything
 * that could throw on an older browser. A choice made this visit counts as saved even when storage
 * is blocked, so the device switching at sunset does not override it. Tiny and dependency free; any failure leaves the light page.
 */
export const THEME_SCRIPT = `(function(){try{
var K="${THEME_KEY}",d=document.documentElement,mq=matchMedia("(prefers-color-scheme: dark)");
var pick=null;
function saved(){try{var t=localStorage.getItem(K);if(t==="light"||t==="dark")return t}catch(e){}return pick}
function meta(n,v){var m=document.head.querySelector('meta[name="'+n+'"]');if(!m){m=document.createElement("meta");m.name=n;document.head.appendChild(m)}m.setAttribute("content",v)}
function apply(t,quiet){if(!quiet)d.setAttribute("data-theme-switching","");d.dataset.theme=t;d.style.colorScheme=t;
meta("theme-color",t==="dark"?"${THEME_BAR.dark}":"${THEME_BAR.light}");meta("apple-mobile-web-app-status-bar-style",t==="dark"?"black":"default");
if(!quiet){requestAnimationFrame(function(){requestAnimationFrame(function(){d.removeAttribute("data-theme-switching")})});dispatchEvent(new Event("${THEME_EVENT}"))}}
window.__sendzzTheme=function(t){pick=t;apply(t)};
apply(saved()||(mq.matches?"dark":"light"),true);
addEventListener("storage",function(e){if(e.key===K&&(e.newValue==="light"||e.newValue==="dark"))apply(e.newValue)});
function onSystem(){if(!saved())apply(mq.matches?"dark":"light")}
if(mq.addEventListener)mq.addEventListener("change",onSystem);else if(mq.addListener)mq.addListener(onSystem);
}catch(e){}})();`;
