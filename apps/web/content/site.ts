/** Main navigation, shared by the header (desktop links + mobile menu) and the footer. */
export type NavLink = { href: string; label: string };

export const MAIN_NAV: NavLink[] = [
  { href: "/product", label: "Product" },
  { href: "/docs/cli", label: "Docs" },
  { href: "/security", label: "Security" },
];

/** The filled button in the header, hero and closing section: open sign-up (DECISIONS #81). */
export const PRIMARY_CTA: NavLink = { href: "/sign-in", label: "Get started free" };

/** The quiet text link beside it, for people who already have an account. */
export const SIGN_IN: NavLink = { href: "/sign-in", label: "Sign in" };

export const FOOTER_NAV: { title: string; links: NavLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Overview" },
      { href: "/roadmap", label: "Roadmap" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs/cli", label: "CLI docs" },
      { href: "https://github.com/imAshutoshGupta/axiomic", label: "Source on GitHub" },
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
