import Link from "next/link";
import styles from "./site.module.css";

/**
 * The logo lockup from public/brand/README.md: icon 30px, wordmark 22px tall, 9px gap.
 * Light and dark files are both in the page; CSS shows the one for the current theme.
 * The images are decorative (alt=""); the link's name comes from the hidden text.
 */
export function BrandLink({ hideWordmarkOnSmall = false }: { hideWordmarkOnSmall?: boolean }) {
  const wordmark = hideWordmarkOnSmall ? `${styles.wordmark} ${styles.wordmarkHideSmall}` : styles.wordmark;
  return (
    <Link href="/" className={styles.brand}>
      <img className="only-light" src="/brand/icon/svg/axiomic-icon-light.svg" alt="" width={30} height={30} />
      <img className="only-dark" src="/brand/icon/svg/axiomic-icon-dark.svg" alt="" width={30} height={30} />
      <img className={`only-light ${wordmark}`} src="/brand/wordmark/svg/axiomic-wordmark-ink.svg" alt="" width={98} height={22} />
      <img className={`only-dark ${wordmark}`} src="/brand/wordmark/svg/axiomic-wordmark-white.svg" alt="" width={98} height={22} />
      <span className="visually-hidden">axiomic home</span>
    </Link>
  );
}
