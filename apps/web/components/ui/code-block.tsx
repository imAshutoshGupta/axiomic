/** CodeBlock: a plain panel for terminal commands or file contents. */
import type { ReactNode } from "react";
import styles from "./code-block.module.css";

type CodeBlockProps = {
  code: string;
  /** Shown above the code: a file path such as ".claude/rules/axiomic.md", or "Terminal". */
  title?: string;
  /**
   * terminal: dark panel; lines starting with "$ " are commands, the rest is output, "# ..." is a comment.
   * file: light panel for file contents.
   */
  variant?: "terminal" | "file";
  /** Wrap long lines instead of scrolling sideways. Good for Markdown, bad for commands. */
  wrap?: boolean;
  /** Small note under the code. */
  note?: ReactNode;
};

/** A plain, unhighlighted code panel. No syntax-highlighting library: the text is short and exact. */
export function CodeBlock({ code, title, variant = "file", wrap = false, note }: CodeBlockProps) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <figure className={`${styles.block} ${styles[variant]}`}>
      {title ? <figcaption className={styles.title}>{title}</figcaption> : null}
      {/* tabIndex lets keyboard users scroll a wide block sideways. */}
      <pre className={wrap ? `${styles.pre} ${styles.wrap}` : styles.pre} tabIndex={wrap ? undefined : 0}>
        <code>
          {lines.map((line, i) => (
            <span key={i} className={styles.line}>
              {variant === "terminal" ? <TerminalLine line={line} /> : line}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
      {note ? <div className={styles.note}>{note}</div> : null}
    </figure>
  );
}

/** "$ axiomic init   # once per repo" → dim prompt, bright command, dim comment. */
function TerminalLine({ line }: { line: string }) {
  if (line.startsWith("$ ")) {
    const rest = line.slice(2);
    const hash = rest.search(/\s#\s/);
    const command = hash === -1 ? rest : rest.slice(0, hash);
    const comment = hash === -1 ? "" : rest.slice(hash);
    return (
      <>
        <span className={styles.prompt} aria-hidden="true">
          ${" "}
        </span>
        <span className={styles.command}>{command}</span>
        {comment ? <span className={styles.comment}>{comment}</span> : null}
      </>
    );
  }
  if (line.trimStart().startsWith("#")) return <span className={styles.comment}>{line}</span>;
  return <span className={styles.output}>{line}</span>;
}
