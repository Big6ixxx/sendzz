import localFont from "next/font/local";

/*
 * The brand's four faces, shipped with the app (app/fonts) rather than fetched from Google
 * Fonts. Nothing is requested from Google at build time or in development, so a build never
 * depends on reaching it, and a dev server with no connection still shows the real fonts.
 *
 * Each file is the Latin subset of a variable font, covering every weight (and, for Bricolage,
 * every width and optical size) the design uses. To update one, download the Latin woff2 from
 * Google Fonts' CSS API for the same axes and replace the file.
 */

const bricolage = localFont({
  src: "../../app/fonts/bricolage-grotesque-latin.woff2",
  weight: "200 800",
  style: "normal",
  declarations: [{ prop: "font-stretch", value: "75% 100%" }],
  variable: "--font-bricolage",
  display: "swap",
});
const instrument = localFont({
  src: "../../app/fonts/instrument-serif-italic-latin.woff2",
  weight: "400",
  style: "italic",
  variable: "--font-instrument",
  display: "swap",
  // A serif stand-in while it loads, sized to match, rather than the default sans.
  adjustFontFallback: "Times New Roman",
});
const geist = localFont({
  src: "../../app/fonts/geist-latin.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist",
  display: "swap",
});
const geistMono = localFont({
  src: "../../app/fonts/geist-mono-latin.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist-mono",
  display: "swap",
});

/** The brand's four faces as CSS variables, set once on <html> (app/layout.tsx). */
export const brandFontVars = `${bricolage.variable} ${instrument.variable} ${geist.variable} ${geistMono.variable}`;
