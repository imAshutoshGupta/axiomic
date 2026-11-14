import type { MetadataRoute } from "next";

// Same values as public/brand/favicon/site.webmanifest. The PNGs live in public/.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "axiomic",
    short_name: "axiomic",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    theme_color: "#07080F",
    background_color: "#07080F",
    display: "standalone",
  };
}
