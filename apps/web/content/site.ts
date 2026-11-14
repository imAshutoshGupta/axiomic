/** Main navigation, shared by the header (desktop links + mobile menu) and the footer. */
export type NavLink = { href: string; label: string };

export const MAIN_NAV: NavLink[] = [
  { href: "/#how", label: "How it works" },
  { href: "/security", label: "Security" },
  { href: "/docs/cli", label: "Docs" },
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
      { href: "/#how", label: "How it works" },
      { href: "/#layers", label: "Rule layers" },
      { href: "/#status", label: "Status" },
    ],
  },
  {
    title: "Docs",
    links: [{ href: "/docs/cli", label: "CLI" }],
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
