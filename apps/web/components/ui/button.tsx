/** ButtonLink: a link styled as a button, in three variants. */
import Link from "next/link";
import type { ComponentProps } from "react";
import styles from "./button.module.css";

type Variant = "primary" | "secondary" | "text";
type Size = "md" | "lg";

type ButtonLinkProps = ComponentProps<typeof Link> & {
  /** primary: filled mint/green. secondary: outlined. text: bold link with no box. */
  variant?: Variant;
  /** md: 44px tall (header). lg: 52px tall (hero). */
  size?: Size;
};

/** A link styled as a button. The site has no form buttons yet, so every "button" is navigation. */
export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ButtonLinkProps) {
  const classes = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  return <Link className={classes} {...props} />;
}
