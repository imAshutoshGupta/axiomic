import Link from "next/link";
import styles from "./site.module.css";

/**
 * The logo lockup from public/brand/README.md: icon 44px, wordmark 25px tall, 10px gap (enlarged from the README 30/22/9 at the user's request).
 * Light and dark files are both in the page; CSS shows the one for the current theme.
 * The images are decorative (alt=""); the link's name comes from the hidden text.
 */
export function BrandLink({ hideWordmarkOnSmall = false }: { hideWordmarkOnSmall?: boolean }) {
  const wordmark = hideWordmarkOnSmall ? `${styles.wordmark} ${styles.wordmarkHideSmall}` : styles.wordmark;
  return (
    <Link href="/" className={styles.brand}>
      <img className="only-light" src="/brand/icon/svg/axiomic-icon-light.svg" alt="" width={44} height={44} />
      <img className="only-dark" src="/brand/icon/svg/axiomic-icon-dark.svg" alt="" width={44} height={44} />
      <img className={`only-light ${wordmark}`} src="/brand/wordmark/svg/axiomic-wordmark-ink.svg" alt="" width={111} height={25} />
      <img className={`only-dark ${wordmark}`} src="/brand/wordmark/svg/axiomic-wordmark-white.svg" alt="" width={111} height={25} />
      <span className="visually-hidden">axiomic home</span>
    </Link>
  );
}
