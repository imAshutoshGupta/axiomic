import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { inter, jetbrainsMono, sourceSerif } from "./fonts";
import { siteUrl } from "../lib/site-url";
import "./globals.css";

// Icons and the link-preview image come from files in this folder (favicon.ico, icon.svg,
// apple-icon.png, opengraph-image.png) and app/manifest.ts. Next.js adds their <head> tags.
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: "axiomic: a private home for your team's AI rule files",
    template: "%s · axiomic",
  },
  description:
    "axiomic keeps your team's CLAUDE.md rules in one private place: layered, versioned and delivered to every developer's AI session. Kept out of Git.",
  applicationName: "axiomic",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFBF8" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0C12" },
  ],
};

// Applies a saved light/dark choice before the first paint, so the page never flashes the wrong theme.
// The theme button (components/site/theme-toggle.tsx) writes this value.
const themeScript = `try{var t=localStorage.getItem("axiomic-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the script above may add data-theme before React loads.
    <html
      lang="en"
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
