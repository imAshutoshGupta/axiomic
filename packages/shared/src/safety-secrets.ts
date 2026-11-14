/**
 * Check: secrets (API keys, tokens, passwords, private keys) pasted into a rule.
 *
 * Rule files end up on every developer's laptop and in every AI session, so a secret in a rule is a leaked secret.
 *
 * Policy:
 * - A secret blocks publishing wherever it is, including inside ``` code blocks: a secret is a secret.
 * - Findings never contain the secret, only a short preview such as "ghp_…" (see redact in safety-core.ts).
 * - Hidden characters are removed before scanning, so "ghp_" + zero-width space + "…" is still caught.
 * - Obvious placeholders don't block: <your-key>, xxxx, YOUR_API_KEY, ${VAR}, process.env.X, AWS's own "…EXAMPLE" keys,
 *   and example connection strings such as postgres://user:password@localhost. See isPlaceholder below.
 *
 * - Known limit, on purpose: a long password made only of letters ("correcthorsebatterystaple") has no digit, so we can't
 *   tell it from a sentence and don't flag it. We would rather miss that than block ordinary prose and make the tool unusable.
 *
 * Avoiding slow regexes (ReDoS): every pattern starts with a fixed prefix and a "lookbehind" such as (?<![A-Za-z0-9_])
 * that only lets a match start at the beginning of a word, and the repeated parts can't overlap with what follows them.
 * That keeps the work roughly proportional to the text length, even for hostile input. safety.test.ts times this.
 */
import { makeLocator, redact, type Finding, type FindingCode, type Severity } from "./safety-core";
import { removeHiddenWithMap } from "./safety-hidden";

/** A provider's key format. Group 1 of `regex` is the random part, which we test for placeholders. */
interface TokenPattern {
  code: FindingCode;
  severity: Severity;
  /** Shown to the author, e.g. "a GitHub token". */
  name: string;
  regex: RegExp;
  /**
   * OpenAI "sk-" is a short prefix that ordinary words ("sk-learn-installation-guide…") also start with, so require a real
   * key shape: upper case, lower case and a digit, and not a run of hyphen-separated lowercase words. See looksLikeOpenAiKey.
   */
  openAiShape?: boolean;
}

// Order matters: when two patterns overlap (e.g. "sk-ant-…" also looks like "sk-…"), the first one wins.
// Provider prefixes that are long and distinctive (ghp_, glpat-, AIza…) are found even when glued to a word or an
// underscore ("tokenghp_…", "x_ghp_…"): nobody needs that to be allowed, and a leak must not hide behind a prefix.
// Short or common prefixes (sk-, hf_, SG., xox…) still need a clean start, or ordinary words would match.
const TOKEN_PATTERNS: TokenPattern[] = [
  { code: "secret.github-token", severity: "block", name: "a GitHub token", regex: /gh[pousr]_([A-Za-z0-9]{36,255})/g },
  { code: "secret.github-token", severity: "block", name: "a GitHub token", regex: /github_pat_([A-Za-z0-9_]{22,255})/g },
  { code: "secret.gitlab-token", severity: "block", name: "a GitLab token", regex: /glpat-([A-Za-z0-9_-]{20,64})/g },
  { code: "secret.anthropic-key", severity: "block", name: "an Anthropic API key", regex: /sk-ant-([A-Za-z0-9_-]{20,255})/g },
  {
    code: "secret.openai-key",
    severity: "block",
    name: "an OpenAI API key",
    regex: /(?<![A-Za-z0-9-])sk-(?!ant-)((?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,255})/g,
    openAiShape: true,
  },
  { code: "secret.stripe-key", severity: "block", name: "a live Stripe key", regex: /[sr]k_live_([A-Za-z0-9]{16,255})/g },
  { code: "secret.stripe-test-key", severity: "warn", name: "a Stripe test key", regex: /[sr]k_test_([A-Za-z0-9]{16,255})/g },
  { code: "secret.slack-token", severity: "block", name: "a Slack token", regex: /xox[abposre]-([A-Za-z0-9-]{10,255})/g },
  {
    code: "secret.slack-webhook",
    severity: "block",
    name: "a Slack webhook URL",
    regex: /https:\/\/hooks\.slack\.com\/services\/(T[A-Z0-9]{6,12}\/B[A-Z0-9]{6,12}\/[A-Za-z0-9]{16,48})/g,
  },
  { code: "secret.google-api-key", severity: "block", name: "a Google API key", regex: /AIza([0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/g },
  { code: "secret.npm-token", severity: "block", name: "an npm token", regex: /npm_([A-Za-z0-9]{36})(?![A-Za-z0-9])/g },
  {
    code: "secret.aws-access-key",
    severity: "block",
    name: "an AWS access key id",
    regex: /(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|APKA)([A-Z0-9]{16})(?![A-Za-z0-9])/g,
  },
  { code: "secret.sendgrid-key", severity: "block", name: "a SendGrid key", regex: /(?<![A-Za-z0-9])SG\.([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})/g },
  // Hugging Face user tokens: "hf_" + about 34 letters and digits.
  { code: "secret.huggingface-token", severity: "block", name: "a Hugging Face token", regex: /(?<![A-Za-z0-9])hf_([A-Za-z0-9]{34,64})(?![A-Za-z0-9])/g },
  // DigitalOcean: dop_v1_ (personal), doo_v1_ (OAuth), dor_v1_ (refresh) + 64 hex characters.
  { code: "secret.digitalocean-token", severity: "block", name: "a DigitalOcean token", regex: /do[por]_v1_([a-f0-9]{64})(?![A-Za-z0-9])/g },
  // Twilio API key: "SK" + 32 lowercase hex. Account SIDs ("AC" + 32 hex) are identifiers, not secrets on their own: warn.
  { code: "secret.twilio-key", severity: "block", name: "a Twilio API key", regex: /(?<![A-Za-z0-9])SK([0-9a-f]{32})(?![A-Za-z0-9])/g },
  { code: "secret.twilio-account-sid", severity: "warn", name: "a Twilio account SID", regex: /(?<![A-Za-z0-9])AC([0-9a-f]{32})(?![A-Za-z0-9])/g },
  // Azure storage connection strings carry "AccountKey=" + 88 base64 characters (we accept 40+).
  { code: "secret.azure-storage-key", severity: "block", name: "an Azure storage account key", regex: /(?<![A-Za-z0-9])AccountKey=([A-Za-z0-9+/]{40,256}={0,2})/gi },
  // JSON Web Token: three base64url parts, the first two starting with "eyJ" ({" in base64). Supabase keys look like this.
  {
    code: "secret.jwt",
    severity: "block",
    name: "a JSON Web Token (e.g. a Supabase key)",
    regex: /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g,
  },
];

/** "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----", "-----BEGIN PGP PRIVATE KEY BLOCK-----" and so on. */
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ ){0,3}PRIVATE KEY(?: BLOCK)?-----/g;
/** One line of key data: base64 characters only. A PEM file wraps them at 64 (or 76), but other tools wrap shorter. */
const KEY_DATA_LINE = /^[A-Za-z0-9+/=]{8,}$/;
/** PEM header lines such as "Proc-Type: 4,ENCRYPTED" or "DEK-Info: AES-128-CBC,ABCD…" that sit before the data. */
const PEM_HEADER_LINE = /^[A-Za-z][A-Za-z0-9-]*: /;
/** How much base64 (in total, across lines) after a header makes it "a real key follows". */
const KEY_DATA_MIN = 40;

/**
 * True if real key data follows the header: base64-looking lines that add up to KEY_DATA_MIN characters.
 * Counting across lines (not one long run) means a key wrapped at 30 characters still counts, while a header followed
 * by ordinary sentences doesn't (a sentence has spaces, so it is not a base64 line and ends the search).
 * `after` is the text right after the header; we only look at the first few lines and stop at "-----END".
 */
function hasKeyData(after: string): boolean {
  let total = 0;
  const lines = after.slice(0, 4000).split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length && i < 80; i++) {
    const line = lines[i]!.trim();
    if (line === "" || (i > 0 && PEM_HEADER_LINE.test(line))) continue;
    if (!KEY_DATA_LINE.test(line)) break; // ordinary text, or the "-----END" line
    total += line.length;
    if (total >= KEY_DATA_MIN) return true;
  }
  return false;
}

/**
 * scheme://user:password@host — any scheme, e.g. postgres, mysql, mongodb+srv, redis, amqp, https. Group 1–4: scheme, user, password, host.
 * The password may contain a raw "/" (people forget to URL-encode it). That also lets "https://site.com:8080/path/x@y" match,
 * so connectionPassword below throws those out. The password part is capped at 256 characters, so it stays fast.
 */
const CONNECTION_STRING = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]{1,20}):\/\/([^\s:/@"'`<>]{0,128}):([^\s@"'`<>]{1,256})@([^\s/"'`<>:?#]{1,255})/dg;

/** "Bearer abc123…", e.g. copied from an Authorization header. Group 1: the token. */
const BEARER = /(?<![A-Za-z0-9_-])bearer[ \t]+([A-Za-z0-9._~+/-]{16,2048}=*)/dgi;

/** "Authorization: Basic dXNlcjpwYXNz", e.g. copied from a curl command. Group 1: the base64 of "user:password". */
const BASIC_AUTH = /(?<![A-Za-z0-9_-])authorization["']?[ \t]{0,5}[:=][ \t]{0,5}["']?basic[ \t]+([A-Za-z0-9+/]{8,2048}={0,2})/dgi;

/**
 * name = value, name: value, "name": "value", name := value, name => value.
 * Group 1: the name. Groups 2/3/4: the value in double quotes, single quotes or bare.
 * We only look closer when the name sounds secret (see isSecretName).
 */
const ASSIGNMENT =
  /(?<![\w.-])["']?([A-Za-z_][\w.-]{0,127})["']?[ \t]{0,10}(?::=|=>|[:=])[ \t]{0,10}(?:"([^"\n]{1,512})"|'([^'\n]{1,512})'|([^\s"'`,;(){}<>[\]]{1,512}))/dg;

/**
 * Does this key name a secret? We look at the key's WORDS and only the end of it counts, because the last word says what
 * the thing is: "db_password", "apiKey", "client-secret", "auth_token", "AWS_SECRET_ACCESS_KEY" are secrets, but
 * "password_policy", "tokenizer", "token_budget", "secretName", "passwordHash" and "client_secret_basic" only talk about one.
 * (The old check looked for the word anywhere inside, which flagged all of those.)
 * Words are split at "-", "_", "." and camelCase humps, so "apiKey" is "api"+"key".
 */
const SECRET_ENDINGS = new Set([
  "password", "passwd", "passphrase", "pwd", "pw", "secret", "secrets", "token", "credential", "credentials",
  "apikey", "accesskey", "privatekey", "authkey", "accountkey", "encryptionkey", "signingkey", "secretkey", "secretkeybase",
]);

function nameWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // apiKey -> api Key
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function isSecretName(key: string): boolean {
  const words = nameWords(key);
  // The last word, the last two joined ("api"+"key") and the last three joined ("secret"+"key"+"base").
  for (let n = 1; n <= 3 && n <= words.length; n++) {
    if (SECRET_ENDINGS.has(words.slice(-n).join(""))) return true;
  }
  return false;
}

/** Shapes that mark a value as a stand-in wherever they appear: "xxxx", "****", "...". Real secrets never contain these. */
const PLACEHOLDER_SHAPES = /x{4,}|\*{3,}|\.{3}|…/i;
/**
 * Sequences like "123456" or "abcdef" (and longer runs of them). A real password can contain one ("Summer123456!"),
 * so a sequence only marks a stand-in when it makes up at least half of the value ("123456", "abcdef123456").
 */
const SEQUENCE = /abcdef[a-z]*|123456[0-9]*/i;
/**
 * Words that mark a value as a stand-in. They are only believed when what is LEFT after removing the word does not look
 * random: "YOUR_API_KEY" and "your-key-here" are placeholders, but "Xk9fQ2mZp7example" is a real-looking secret that happens
 * to contain "example", so it still counts (a secret must not be allowed through just by adding a word to it).
 */
const PLACEHOLDER_WORDS = /your|example|placeholder|redacted|changeme|change[-_]me|dummy|sample|replace|insert|fake/i;
/** References to where the real secret lives: $VAR, %VAR%, process.env.X, ${{ secrets.X }}, op://vault/item… */
const REFERENCE = /^(?:\$|%[A-Za-z_]|process\.env|import\.meta\.env|os\.environ|env\.|secrets\.|vars\.|op:\/\/|vault:|getenv|ENV\[)/i;
/** AWS's own documentation keys end in EXAMPLE or EXAMPLEKEY: "…bPxRfiCYEXAMPLEKEY". */
const AWS_EXAMPLE = /EXAMPLE(?:KEY)?$/;

/** How many of lower case / upper case / digit / symbol a value uses (spaces don't count). */
function characterClasses(value: string): number {
  return (
    Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/[0-9]/.test(value)) + Number(/[^A-Za-z0-9\s]/.test(value))
  );
}

/** Random-looking: long enough, mixed characters, and unpredictable. Used to decide whether a placeholder word is hiding a real value. */
function looksRandom(value: string): boolean {
  return value.length >= 8 && characterClasses(value) >= 3 && entropy(value) >= 3.0 && !isWordLike(value);
}

/** Lowercase words (each maybe with a few digits) joined by - _ or .: "my-app-secret-v2", "correct-horse-battery-staple-9". */
function wordSegments(value: string): string[] | undefined {
  const segments = value.split(/[-_.]/).filter(Boolean); // (a leading or doubled separator leaves an empty piece)
  const wordLike = segments.length >= 2 && segments.every((part) => /^(?:[a-z]+[0-9]{0,3}|v?[0-9]{1,6}[a-z]{0,12})$/.test(part));
  return wordLike ? segments : undefined;
}
function isWordLike(value: string): boolean {
  return wordSegments(value) !== undefined;
}

/** True for values that are obviously not a real secret. */
export function isPlaceholder(value: string): boolean {
  if (/[<>]|\$\{|\{\{/.test(value)) return true; // <your-key>, ${VAR}, {{ secret }}
  if (REFERENCE.test(value)) return true;
  if (PLACEHOLDER_SHAPES.test(value)) return true;
  const sequence = SEQUENCE.exec(value);
  if (sequence && sequence[0].length * 2 >= value.length) return true;
  if (AWS_EXAMPLE.test(value)) return true;
  const word = PLACEHOLDER_WORDS.exec(value);
  if (word && !looksRandom(value.slice(0, word.index) + value.slice(word.index + word[0].length))) return true;
  // Real secrets are random. "aaaaaaaa" or "abababab" are not.
  if (new Set(value).size <= 3) return true;
  return false;
}

/** Common example passwords in connection strings: postgres://postgres:postgres@…, amqp://guest:guest@… */
const EXAMPLE_PASSWORDS = new Set([
  "password", "pass", "passwd", "pwd", "pw", "secret", "changeme", "postgres", "root", "admin", "guest",
  "test", "example", "mysecretpassword", "user", "username", "dbpass", "dbpassword",
]);

/** Hosts that only exist on a developer's own machine, or are reserved for examples. */
const LOCAL_HOST =
  /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|host\.docker\.internal|db|database|postgres|mysql|mariadb|mongo|mongodb|redis|rabbitmq)$|\.(?:local|localhost|test|example|invalid)$|(?:^|\.)example\.(?:com|org|net)$/i;

/**
 * Finds secrets in one field.
 * Patterns run from most specific to most general, and a later pattern skips text an earlier one already reported,
 * so "Bearer ghp_…" gives one "GitHub token" finding, not two.
 */
export function findSecrets(field: "title" | "body", text: string): Finding[] {
  const { text: clean, origin } = removeHiddenWithMap(text);
  const locate = makeLocator(text);
  const findings: Finding[] = [];
  // One flag per character of `clean`: already part of a finding? Checking a new match costs only its own length,
  // where a list of ranges had to be searched in full for every match (slow when a text has thousands of them).
  const claimed = new Uint8Array(clean.length);

  /** Records a finding, translating positions in the cleaned text back to the original text. */
  function report(start: number, end: number, code: FindingCode, severity: Severity, message: string, preview: string) {
    for (let i = start; i < end; i++) if (claimed[i]) return; // overlaps an earlier, more specific finding
    claimed.fill(1, start, end);
    const offset = origin[start]!;
    const length = origin[end - 1]! + 1 - offset;
    findings.push({ code, severity, message, field, offset, length, ...locate(offset), preview });
  }

  // 1. Private keys. Only the header + real key data blocks; a lone header (e.g. in an explanation) just warns.
  for (const m of clean.matchAll(PRIVATE_KEY)) {
    const end = m.index + m[0].length;
    const hasData = hasKeyData(clean.slice(end, end + 4000));
    report(
      m.index,
      end,
      hasData ? "secret.private-key" : "secret.private-key-header",
      hasData ? "block" : "warn",
      hasData
        ? "Contains a private key. Remove it and treat the key as leaked: replace it."
        : "Contains a private key header. If a real key follows, remove it.",
      "-----BEGIN …",
    );
  }

  // 2. Provider keys with a known shape.
  for (const pattern of TOKEN_PATTERNS) {
    for (const m of clean.matchAll(pattern.regex)) {
      const random = m[1]!;
      if (isPlaceholder(random)) continue;
      if (pattern.openAiShape && !looksLikeOpenAiKey(random)) continue;
      report(m.index, m.index + m[0].length, pattern.code, pattern.severity, leakMessage(pattern.name, pattern.severity), redact(m[0]));
    }
  }

  // 3. Connection strings with a password in them.
  for (const m of clean.matchAll(CONNECTION_STRING)) {
    const scheme = m[1]!;
    const user = m[2]!;
    const password = m[3]!;
    const host = m[4]!;
    if (isPlaceholder(password) || EXAMPLE_PASSWORDS.has(password.toLowerCase()) || password === user) continue;
    // A "/" in the password is only believable if the part before it isn't a port number ("site.com:8080/path/x@y") and it looks like a password.
    if (password.includes("/") && (/^[0-9]{1,5}\//.test(password) || !hasLetterAndDigit(password))) continue;
    const local = LOCAL_HOST.test(host);
    report(
      m.index,
      m.index + m[0].length,
      local ? "secret.connection-string-local" : "secret.connection-string",
      local ? "warn" : "block",
      local
        ? "Contains a connection string with a password for a local or example database. Use a placeholder like <password> instead."
        : "Contains a connection string with a password in it. Remove the password and treat it as leaked: change it.",
      `${scheme}://…`,
    );
  }

  // 4. Authorization headers: "Basic <base64 of user:password>" and "Bearer <token>".
  for (const m of clean.matchAll(BASIC_AUTH)) {
    const encoded = m[1]!;
    const decoded = decodeBase64(encoded);
    // Real Basic credentials decode to "user:password". Anything else (or a stand-in password) isn't a credential.
    const colon = decoded?.indexOf(":") ?? -1;
    if (decoded === undefined || colon < 1) continue;
    const password = decoded.slice(colon + 1);
    if (password === "" || isPlaceholder(password) || EXAMPLE_PASSWORDS.has(password.toLowerCase())) continue;
    const [start, end] = m.indices![1]!;
    report(start, end, "secret.basic-auth", "block", leakMessage("HTTP Basic credentials", "block"), redact(encoded));
  }
  for (const m of clean.matchAll(BEARER)) {
    const token = m[1]!;
    if (isPlaceholder(token) || !hasLetterAndDigit(token)) continue;
    const [start, end] = m.indices![1]!;
    report(start, end, "secret.bearer-token", "block", leakMessage("a bearer token", "block"), redact(token));
  }

  // 5. Generic "password = …" style assignments, if the key names a secret and the value looks like one.
  for (const m of clean.matchAll(ASSIGNMENT)) {
    if (!isSecretName(m[1]!)) continue;
    const name = m[1]!.toLowerCase().replace(/[-_.]/g, "");
    const group = m[2] !== undefined ? 2 : m[3] !== undefined ? 3 : 4;
    const quoted = group !== 4;
    const value = m[group]!;
    const [start, end] = m.indices![group]!;

    // AWS secret access keys are exactly 40 base64 characters, named e.g. aws_secret_access_key.
    if (name.includes("secret") && (name.includes("aws") || name.includes("accesskey")) && /^[A-Za-z0-9/+]{40}$/.test(value) && !isPlaceholder(value)) {
      report(start, end, "secret.aws-secret-key", "block", leakMessage("an AWS secret access key", "block"), redact(value));
      continue;
    }
    const verdict = judgeValue(value, quoted);
    if (!verdict) continue;
    report(
      start,
      end,
      "secret.assignment",
      verdict,
      verdict === "block"
        ? `Looks like a real value for "${m[1]}". Don't put secrets in rules; use a placeholder like <${m[1]}> instead.`
        : `The value for "${m[1]}" might be a real secret. If it is, remove it and use a placeholder like <${m[1]}> instead.`,
      redact(value),
    );
  }

  return findings.sort((a, b) => a.offset! - b.offset!);
}

/**
 * Judges the value in "password = value": "block" if it's very likely a real secret, "warn" if it might be one,
 * undefined if it's not worth mentioning. Blocking ordinary text makes the whole tool unusable, so blocking needs real evidence:
 * - Not a secret at all: under 8 characters, placeholders, paths and URLs, no digit or no letter, version numbers
 *   ("v2.1.3-beta"), a word plus a few digits ("bcrypt12"), a number plus a unit ("8000tokens").
 * - Word-like: lowercase words joined by - or _ ("correct-horse-battery-staple-9", "my-app-secret-v2"). Plausibly a real passphrase,
 *   plausibly a name, so at most "warn", and only when there are 4+ words.
 * - Block: no spaces, and either mixed characters (3 of lower/upper/digit/symbol) with enough length and entropy,
 *   or a long (20+) hex-like string. A bare (unquoted) value must be longer and more random than a quoted one,
 *   because a quote is a clear sign the author meant "this is a string value".
 * - Everything else with some randomness: "warn".
 */
function judgeValue(value: string, quoted: boolean): Severity | undefined {
  if (value.length < 8) return undefined;
  if (isPlaceholder(value)) return undefined;
  if (/^(?:\/|\.{1,2}\/|~\/)/.test(value) || value.includes("://")) return undefined; // a path or URL, not a secret
  if (!hasLetterAndDigit(value)) return undefined; // "true", "enabled", "4096", "correcthorse" (letters-only passwords are missed on purpose)
  if (/^v?[0-9]+(?:\.[0-9]+)*(?:[-+][\w.]+)?$/i.test(value)) return undefined; // 1.2.3, v2.1.3-beta
  if (/^[a-z]+[0-9]{1,4}$|^[0-9]{1,6}[a-z]{1,12}$/.test(value)) return undefined; // bcrypt12, 8000tokens

  const words = wordSegments(value);
  if (words) return words.length >= 4 ? "warn" : undefined;
  if (/^(?:[A-Z][a-z]+[0-9]{0,2}){3,}$/.test(value)) return "warn"; // MyAppSecretNameV2: PascalCase words

  const classes = characterClasses(value);
  const bits = entropy(value);
  // A quoted value with spaces ("Xk9 fQ2 mZp7 Lq") never blocks, only warns: it may be prose. Deliberate.
  if (!/\s/.test(value)) {
    if (classes >= 3 && value.length >= (quoted ? 10 : 12) && bits >= (quoted ? 3.0 : 3.2)) return "block";
    if (classes >= 2 && value.length >= 20 && bits >= 3.3) return "block";
  }
  return bits >= 2.5 ? "warn" : undefined;
}

/**
 * OpenAI keys are long and random: upper case, lower case and digits all present, and not hyphen-separated lowercase words.
 * Without this, "sk-learn-installation-guide2-for-python-users" (a pip package name) would block a rule.
 */
function looksLikeOpenAiKey(random: string): boolean {
  if (!/[a-z]/.test(random) || !/[A-Z]/.test(random) || !/[0-9]/.test(random)) return false;
  const words = random.split(/[-_]/).filter((part) => /^[a-z]{3,}$/.test(part));
  return words.length < 2;
}

/** Decodes standard base64 to text, or undefined if it isn't valid. Small and dependency-free, so it works in any JavaScript runtime. */
function decodeBase64(encoded: string): string | undefined {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const data = encoded.replace(/=+$/, "");
  if (data.length % 4 === 1) return undefined;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of data) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return String.fromCharCode(...bytes);
}

function hasLetterAndDigit(value: string): boolean {
  return /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

/**
 * Shannon entropy in bits per character: how unpredictable the characters are.
 * "aaaaaaaa" scores 0; 8 all-different characters score 3. Random keys score high, words and versions low.
 */
export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  const length = [...value].length;
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function leakMessage(name: string, severity: Severity): string {
  return severity === "block"
    ? `Contains what looks like ${name}. Remove it and treat it as leaked: revoke it and make a new one.`
    : `Contains what looks like ${name}. Test keys and account ids are low-risk, but rules are not the place for them.`;
}
