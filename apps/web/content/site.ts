/** Main navigation, shared by the header (desktop links + mobile menu) and the footer. */
export type NavLink = { href: string; label: string };

export const MAIN_NAV: NavLink[] = [
  { href: "/product", label: "Product" },
  { href: "/features", label: "Features" },
  { href: "/docs/cli", label: "Docs" },
  { href: "/security", label: "Security" },
];

/**
 * The filled button in the header and hero. The mockup says "Get early access", but there is
 * no sign-up or waitlist yet, so it points at the honest pilot status instead.
 */
export const PRIMARY_CTA: NavLink = { href: "/#status", label: "See pilot status" };

export const FOOTER_NAV: { title: string; links: NavLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Overview" },
      { href: "/features", label: "Features" },
      { href: "/roadmap", label: "Roadmap" },
      { href: "/#how", label: "How it works" },
    ],
  },
  {
    title: "Docs",
    links: [
      { href: "/docs/cli", label: "CLI" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/security", label: "Security" },
      { href: "/privacy", label: "Privacy (draft)" },
      { href: "/terms", label: "Terms (draft)" },
    ],
  },
];
