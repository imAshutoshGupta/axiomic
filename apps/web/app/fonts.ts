import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";

/*
 * The three families the hero mockup uses. next/font downloads them at build time and
 * serves them from our own domain, so visitors' browsers never contact Google.
 * Each one sets a CSS variable that globals.css turns into --font-sans / --font-serif / --font-mono.
 */

/** Body text, buttons, navigation. */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/** Headings and captions. Includes the optical-size axis: the hero title sets 'opsz' 60. */
export const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-source-serif",
  display: "swap",
});

/** File names, commands, rule files. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
