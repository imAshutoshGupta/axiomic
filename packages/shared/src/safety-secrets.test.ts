import { describe, expect, it } from "vitest";
import { entropy, findSecrets, isPlaceholder } from "./safety-secrets";

// IMPORTANT: every "secret" here is fake. They're built by joining strings, so they have the right shape
// for our checks but never appear whole in the source code, where they could trip a secret scanner.

/** A fake random-looking string of length n: mixed case and digits, no placeholder words. */
const fake = (n: number) => "a1B2c3D4e5F6g7H8j9K0mNpQrStUvWyZ".repeat(Math.ceil(n / 32)).slice(0, n);
/** Upper case and digits only, for AWS access key ids. */
const fakeUpper = (n: number) => "Q7W3E9R2T5Y8U4I6P1L0K2J3H4G5F6D7".repeat(Math.ceil(n / 32)).slice(0, n);

const codes = (text: string) => findSecrets("body", text).map((f) => f.code);
const blocks = (text: string) => findSecrets("body", text).filter((f) => f.severity === "block").length > 0;

describe("findSecrets: provider keys", () => {
  const cases: [string, string, string][] = [
    ["GitHub classic token", "gh" + "p_" + fake(36), "secret.github-token"],
    ["GitHub OAuth token", "gh" + "o_" + fake(36), "secret.github-token"],
    ["GitHub user-to-server token", "gh" + "u_" + fake(36), "secret.github-token"],
    ["GitHub server token", "gh" + "s_" + fake(36), "secret.github-token"],
    ["GitHub refresh token", "gh" + "r_" + fake(36), "secret.github-token"],
    ["GitHub fine-grained token", "github" + "_pat_" + fake(22) + "_" + fake(59), "secret.github-token"],
    ["GitLab token", "gl" + "pat-" + fake(20), "secret.gitlab-token"],
    ["Anthropic key", "sk-" + "ant-api03-" + fake(80), "secret.anthropic-key"],
    ["OpenAI project key", "sk-" + "proj-" + fake(48), "secret.openai-key"],
    ["OpenAI legacy key", "sk-" + fake(48), "secret.openai-key"],
    ["Stripe live secret key", "sk" + "_live_" + fake(24), "secret.stripe-key"],
    ["Stripe live restricted key", "rk" + "_live_" + fake(24), "secret.stripe-key"],
    ["Slack bot token", "xo" + "xb-" + "1234-5678-" + fake(24), "secret.slack-token"],
    ["Slack webhook", "https://hooks.slack.com/services/" + "T0" + fakeUpper(8) + "/B0" + fakeUpper(8) + "/" + fake(24), "secret.slack-webhook"],
    ["Google API key", "AI" + "za" + fake(35), "secret.google-api-key"],
    ["npm token", "np" + "m_" + fake(36), "secret.npm-token"],
    ["AWS access key id", "AK" + "IA" + fakeUpper(16), "secret.aws-access-key"],
    ["AWS temporary key id", "AS" + "IA" + fakeUpper(16), "secret.aws-access-key"],
    ["SendGrid key", "SG" + "." + fake(22) + "." + fake(43), "secret.sendgrid-key"],
    ["JWT / Supabase key", "ey" + "J" + fake(20) + ".ey" + "J" + fake(40) + "." + fake(43), "secret.jwt"],
  ];

  for (const [name, secret, code] of cases) {
    it(`blocks a ${name}`, () => {
      const [finding] = findSecrets("body", `Use this: ${secret} for deploys.`);
      expect(finding?.code).toBe(code);
      expect(finding?.severity).toBe("block");
    });
  }

  it("warns (doesn't block) for a Stripe test key", () => {
    const [finding] = findSecrets("body", "sk" + "_test_" + fake(24));
    expect(finding).toMatchObject({ code: "secret.stripe-test-key", severity: "warn" });
  });

  it("calls an Anthropic key an Anthropic key, not an OpenAI one", () => {
    expect(codes("sk-" + "ant-api03-" + fake(80))).toEqual(["secret.anthropic-key"]);
  });

  it("finds a key inside a fenced code block too", () => {
    expect(codes("```bash\nexport GH=" + "gh" + "p_" + fake(36) + "\n```")).toEqual(["secret.github-token"]);
  });

  it("finds a key in the title", () => {
    expect(findSecrets("title", "Token " + "gh" + "p_" + fake(36))[0]?.field).toBe("title");
  });

  it("doesn't match when the key is part of a longer word", () => {
    // (GitHub tokens are the exception now: a distinctive prefix glued to a word is still found. See "glued" below.)
    expect(codes("myAK" + "IA" + fakeUpper(16))).toEqual([]);
  });

  it("doesn't flag an ordinary word that starts with sk-", () => {
    expect(codes("We use sk-learn-classifier-module-utils for this.")).toEqual([]);
  });
});

describe("findSecrets: placeholders don't block", () => {
  const placeholders = [
    "gh" + "p_" + "x".repeat(36),
    "gh" + "p_" + "X".repeat(36),
    "gh" + "p_" + "a".repeat(36), // only one distinct character: not random
    "sk-...",
    "sk-" + "proj-" + "xxxx".repeat(12),
    "sk-" + "your-api-key-goes-here-1234",
    "AK" + "IA" + "IOSFODNN7" + "EXAMPLE", // AWS's own documentation example
    "api_key=YOUR_API_KEY",
    "api_key=<your-key>",
    "API_KEY=${API_KEY}",
    "token: process.env.GITHUB_TOKEN",
    "password = os.environ['DB_PASSWORD']",
    "secret: ${{ secrets.DEPLOY_KEY }}",
    "TOKEN=$GITHUB_TOKEN",
    "password: ********",
    "Authorization: Bearer <token>",
    "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE",
    "postgres://user:password@localhost:5432/app",
    "postgres://postgres:postgres@localhost/app",
    "amqp://guest:guest@localhost:5672",
    "mongodb+srv://<user>:<password>@cluster0.example.net/db",
    "redis://:${REDIS_PASSWORD}@redis:6379",
  ];

  for (const text of placeholders) {
    it(`ignores ${JSON.stringify(text)}`, () => {
      expect(blocks(text)).toBe(false);
    });
  }

  it("treats placeholder words, references and low variety as placeholders", () => {
    expect(isPlaceholder("<your-key>")).toBe(true);
    expect(isPlaceholder("process.env.KEY")).toBe(true);
    expect(isPlaceholder("REDACTED")).toBe(true);
    expect(isPlaceholder("abababab")).toBe(true);
    expect(isPlaceholder(fake(36))).toBe(false);
  });
});

describe("findSecrets: private keys", () => {
  const body = "MIIE" + fake(60) + "\n" + fake(64);

  for (const kind of ["", "RSA ", "EC ", "OPENSSH ", "ENCRYPTED ", "PGP "]) {
    it(`blocks a ${kind || "plain "}private key with key data`, () => {
      const suffix = kind === "PGP " ? " BLOCK" : "";
      const text = `-----BEGIN ${kind}PRIVATE KEY${suffix}-----\n${body}\n-----END ${kind}PRIVATE KEY${suffix}-----`;
      expect(findSecrets("body", text)[0]).toMatchObject({ code: "secret.private-key", severity: "block" });
    });
  }

  it("only warns about a header with no key data after it", () => {
    const [finding] = findSecrets("body", "Never commit files that start with -----BEGIN RSA PRIVATE KEY----- to Git.");
    expect(finding).toMatchObject({ code: "secret.private-key-header", severity: "warn" });
  });

  it("ignores a public key", () => {
    expect(codes(`-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`)).toEqual([]);
  });
});

describe("findSecrets: connection strings", () => {
  const pass = "Zq8" + fake(13);

  for (const scheme of ["postgres", "postgresql", "mysql", "mongodb", "mongodb+srv", "redis", "rediss", "amqp", "amqps", "https"]) {
    it(`blocks a ${scheme} URL with a real-looking password`, () => {
      const [finding] = findSecrets("body", `DATABASE_URL=${scheme}://app_user:${pass}@db.prod.acme-corp.io:5432/main`);
      expect(finding).toMatchObject({ code: "secret.connection-string", severity: "block", preview: `${scheme}://…` });
    });
  }

  it("blocks a password with no user name (redis://:pass@host)", () => {
    expect(codes(`redis://:${pass}@cache.acme-corp.io:6379`)).toEqual(["secret.connection-string"]);
  });

  it("only warns for a real-looking password on localhost or a docker service", () => {
    expect(findSecrets("body", `postgres://app:${pass}@localhost:5432/app`)[0]).toMatchObject({ code: "secret.connection-string-local", severity: "warn" });
    expect(codes(`postgres://app:${pass}@db:5432/app`)).toEqual(["secret.connection-string-local"]);
  });

  it("ignores URLs without a password", () => {
    expect(codes("postgres://localhost:5432/app and https://user@github.com/org/repo")).toEqual([]);
  });
});

describe("findSecrets: bearer tokens and assignments", () => {
  it("blocks a bearer token", () => {
    const [finding] = findSecrets("body", `curl -H "Authorization: Bearer ${fake(40)}" https://api.acme-corp.io`);
    expect(finding).toMatchObject({ code: "secret.bearer-token", severity: "block" });
  });

  it("reports a GitHub token after Bearer once, as a GitHub token", () => {
    expect(codes("Authorization: Bearer " + "gh" + "p_" + fake(36))).toEqual(["secret.github-token"]);
  });

  const assignments = [
    `password=${fake(16)}`,
    `DB_PASSWORD: "${fake(20)}"`,
    `"client_secret": "${fake(32)}"`,
    `apiKey = '${fake(24)}'`,
    `export AUTH_TOKEN=${fake(30)}`,
    `secret := ${fake(12)}`,
    `- token: ${fake(24)}`,
  ];
  for (const text of assignments) {
    it(`blocks ${text.split(/[:=]/)[0]!.trim()} with a random value`, () => {
      expect(codes(text)).toEqual(["secret.assignment"]);
    });
  }

  it("names an AWS secret access key", () => {
    expect(codes(`aws_secret_access_key = ${fake(40)}`)).toEqual(["secret.aws-secret-key"]);
  });

  const harmless = [
    "max_tokens=4096",
    "password: correcthorsebatterystaple", // letters only: we can't tell it from a word
    "secret=true",
    "token_limit: 8000",
    "password_min_length=12",
    "secret_file=/etc/app/secret-1.pem",
    "token_url=https://auth.acme-corp.io/oauth2/token",
    "Store the token: never in localStorage.",
    "version=1.2.3",
    "api_key=YOUR_KEY_1",
  ];
  for (const text of harmless) {
    it(`ignores ${JSON.stringify(text)}`, () => {
      expect(codes(text)).toEqual([]);
    });
  }
});

describe("findSecrets: evasion and reporting", () => {
  it("still finds a token split by a zero-width space, and reports its real position", () => {
    const token = "gh" + "p_" + fake(10) + "\u200B" + fake(26);
    const text = `Line one\nUse ${token} here`;
    const [finding] = findSecrets("body", text);
    expect(finding?.code).toBe("secret.github-token");
    expect(finding?.offset).toBe(text.indexOf("gh"));
    expect(finding?.length).toBe(token.length); // includes the hidden character
    expect(finding).toMatchObject({ line: 2, column: 5 });
  });

  it("never puts the secret in the finding, only a short preview", () => {
    const secrets = ["gh" + "p_" + fake(36), `password=${fake(16)}`, `postgres://u:${"Zq8" + fake(13)}@db.acme-corp.io/x`, "Bearer " + fake(40)];
    for (const secret of secrets) {
      const [finding] = findSecrets("body", secret);
      const json = JSON.stringify(finding);
      expect(finding).toBeDefined();
      // No 8-character piece of the random part may appear anywhere in the finding.
      const random = fake(36);
      for (let i = 0; i + 8 <= random.length; i++) expect(json).not.toContain(random.slice(i, i + 8));
      expect(finding!.preview!.length).toBeLessThanOrEqual(5 + "postgres://".length);
    }
  });

  it("reports every secret, in order", () => {
    const text = "gh" + "p_" + fake(36) + "\n" + "np" + "m_" + fake(36);
    expect(codes(text)).toEqual(["secret.github-token", "secret.npm-token"]);
  });
});

describe("entropy", () => {
  it("is 0 for one repeated character and 3 for eight different ones", () => {
    expect(entropy("aaaaaaaa")).toBe(0);
    expect(entropy("abcdefgh")).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
// Review fixes. Fixtures are still built by joining strings.
// ---------------------------------------------------------------------------------------------

/** 64 lowercase hex characters with no run like "123456" or "abcdef" (those look like placeholders). */
const hex = (n: number) => "9f3a7c1e5b2d8046".repeat(Math.ceil(n / 16)).slice(0, n);
const severities = (text: string) => findSecrets("body", text).map((f) => `${f.code}:${f.severity}`);

describe("findSecrets: ordinary text with a secret-sounding word in it doesn't block", () => {
  // Each of these used to block, because the key was matched as a substring ("tokenizer" contains "token").
  const ordinary = [
    "tokenizer: v2.1.3-beta",
    "secretName: my-app-secret-v2",
    "password_policy: strict-12chars",
    "token_budget: 8000tokens",
    "passwordHash: bcrypt12",
    "secrets: aws-secrets-manager-v2",
    "client_secret_basic: authentication2methods",
    "sk-learn-installation-guide2-for-python-users",
    "sk-1-mypackage-name-that-is-longer-than-20",
    "token_endpoint_auth_method: client2secret",
    "tokenUrl: /oauth/token2",
    "SECRET_KEY_BASE=changeme123",
  ];
  for (const text of ordinary) {
    it(`does not block "${text}"`, () => {
      expect(blocks(text)).toBe(false);
    });
  }

  it("matches the secret word only as the last word of the key", () => {
    // Last word: these are secrets (the value is random).
    for (const key of ["password", "DB_PASSWORD", "apiKey", "api_key", "client_secret", "auth_token", "refreshToken", "x-api-key", "pwd", "pw"]) {
      expect(blocks(`${key}=${fake(16)}`), key).toBe(true);
    }
    // Not last: the key is about a secret, not a secret.
    for (const key of ["password_policy", "tokenizer", "token_budget", "secretName", "passwordHash", "secret_file", "token_limit"]) {
      expect(blocks(`${key}=${fake(16)}`), key).toBe(false);
    }
  });

  it("says 'warn', not 'block', for a passphrase that could be prose or real", () => {
    expect(severities("passphrase: correct-horse-battery-staple-9")).toEqual(["secret.assignment:warn"]);
  });

  it("says nothing for short word-like, version and number+unit values", () => {
    expect(codes("secret: use-vault-kv2")).toEqual([]);
    expect(codes("token: v2.1.3-beta")).toEqual([]);
    expect(codes("password: 8000tokens")).toEqual([]);
  });

  it("still blocks genuinely random values, bare or quoted", () => {
    expect(severities("password=Zq7Kp2LmN8xR4tVb")).toEqual(["secret.assignment:block"]);
    expect(severities('API_KEY="a8F3kP9zQ2mX7vL1"')).toEqual(["secret.assignment:block"]);
    expect(severities(`token: ${hex(32)}`)).toEqual(["secret.assignment:block"]); // a long hex token
  });

  it("is stricter with a bare value than a quoted one", () => {
    // 10 characters, mixed: enough evidence inside quotes, only a hint without.
    expect(severities('password: "Zq7Kp2LmN8"')).toEqual(["secret.assignment:block"]);
    expect(severities("password: Zq7Kp2LmN8")).toEqual(["secret.assignment:warn"]);
  });

  it("only warns for a short, mixed value (plausible but unproven)", () => {
    expect(severities("password: Passw0rd!")).toEqual(["secret.assignment:warn"]);
  });

  it("leaves a letters-only password alone, on purpose", () => {
    // No digit, so we can't tell it from a sentence; blocking prose would make the tool unusable.
    expect(codes("password: correcthorsebatterystaplexyz")).toEqual([]);
  });
});

describe("findSecrets: OpenAI keys need a real key shape", () => {
  it("blocks a long mixed-case key, with or without a project prefix", () => {
    expect(codes("sk-" + fake(48))).toEqual(["secret.openai-key"]);
    expect(codes("sk-" + "proj-" + fake(60))).toEqual(["secret.openai-key"]);
  });
  it("ignores package names and kebab-case words that start with sk-", () => {
    expect(codes("pip install sk-learn-installation-guide2-for-python-users")).toEqual([]);
    expect(codes("sk-1-mypackage-name-that-is-longer-than-20")).toEqual([]);
    expect(codes("sk-" + "a1".repeat(24))).toEqual([]); // lower case only: not a key
  });
});

describe("findSecrets: placeholder words", () => {
  it("exempts a whole placeholder word in a low-entropy value", () => {
    for (const value of ["YOUR_API_KEY_1", "your-api-key-here", "replace-with-real-key2", "dummy_secret_value1", "sample-token-0042", "insert_token_here9", "fake-password-12"]) {
      expect(isPlaceholder(value), value).toBe(true);
    }
  });
  it("does not exempt a random-looking value just because it contains one of the words", () => {
    for (const word of ["your", "fake", "sample", "dummy", "insert", "example"]) {
      const value = "Xk9fQ2mZp7" + word + "Lq4Rt8";
      expect(isPlaceholder(value), value).toBe(false);
      expect(blocks(`password=${value}`), value).toBe(true);
    }
  });
  it("still exempts AWS's documentation keys", () => {
    expect(codes("AKIAIOSFODNN7EXAMPLE")).toEqual([]);
    expect(codes("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")).toEqual([]);
  });
});

describe("findSecrets: provider keys glued to other characters", () => {
  const token = "gh" + "p_" + fake(36);
  it("finds a GitHub token after a word or an underscore", () => {
    expect(codes("token" + token)).toEqual(["secret.github-token"]);
    expect(codes("x_" + token)).toEqual(["secret.github-token"]);
    expect(codes("GITHUB_TOKEN_" + token)).toEqual(["secret.github-token"]);
  });
  it("does the same for other distinctive prefixes", () => {
    expect(codes("key" + "AI" + "za" + fake(35))).toEqual(["secret.google-api-key"]);
    expect(codes("x_" + "sk" + "_live_" + fake(24))).toEqual(["secret.stripe-key"]);
    expect(codes("a" + "np" + "m_" + fake(36))).toEqual(["secret.npm-token"]);
  });
});

describe("findSecrets: more secret families", () => {
  const cases: [string, string, string, string][] = [
    ["Hugging Face token", "h" + "f_" + fake(34), "secret.huggingface-token", "block"],
    ["DigitalOcean personal token", "do" + "p_v1_" + hex(64), "secret.digitalocean-token", "block"],
    ["Twilio API key", "S" + "K" + hex(32), "secret.twilio-key", "block"],
    ["Twilio account SID", "A" + "C" + hex(32), "secret.twilio-account-sid", "warn"],
    ["Azure storage key", "Account" + "Key=" + fake(86) + "==", "secret.azure-storage-key", "block"],
    ["SendGrid key", "S" + "G." + fake(22) + "." + fake(43), "secret.sendgrid-key", "block"],
    ["GitLab token", "gl" + "pat-" + fake(20), "secret.gitlab-token", "block"],
    ["Basic auth header", "Authorization: Basic " + btoa("deploy:" + fake(14)), "secret.basic-auth", "block"],
    ["Basic auth in curl", "curl -H 'Authorization: Basic " + btoa("ci:" + fake(14)) + "' https://x.acme-corp.io", "secret.basic-auth", "block"],
  ];
  for (const [name, text, code, severity] of cases) {
    it(`finds a ${name}`, () => {
      expect(severities(`Use ${text} here`)).toEqual([`${code}:${severity}`]);
    });
  }

  const nearMisses: [string, string][] = [
    ["a Hugging Face prefix with a short tail", "h" + "f_" + fake(20)],
    ["the word hf_cache_dir", "hf_cache_dir_for_models"],
    ["a DigitalOcean prefix with 63 hex characters", "do" + "p_v1_" + hex(63)],
    ["a Twilio prefix with 31 hex characters", "S" + "K" + hex(31)],
    ["SK followed by non-hex", "S" + "K" + "z".repeat(32)],
    ["an Account SID that is longer than 32 hex", "A" + "C" + hex(40)],
    ["an Azure AccountKey that is too short", "Account" + "Key=" + "short1"],
    ["a SendGrid prefix with short parts", "S" + "G." + fake(10) + "." + fake(10)],
    ["a Basic header with a placeholder password", "Authorization: Basic " + btoa("user:password")],
    ["a Basic header that isn't user:password", "Authorization: Basic " + btoa("justonevaluewithnocolon")],
    ["a Basic header placeholder", "Authorization: Basic <base64-credentials>"],
  ];
  for (const [name, text] of nearMisses) {
    it(`ignores ${name}`, () => {
      expect(severities(text)).toEqual([]);
    });
  }

  it("recognises the extra secret names", () => {
    for (const key of ["encryption_key", "signing_key", "private_key", "access_key", "accountkey", "AccountKey", "pwd", "pw", "ENCRYPTION_KEY"]) {
      expect(blocks(`${key}: ${fake(20)}`), key).toBe(true);
    }
  });
});

describe("findSecrets: connection strings with a raw slash", () => {
  it("blocks a password that contains a / (not URL-encoded)", () => {
    expect(codes("postgres://admin:Xk9fQ/2mZp7Rt@prod.acme-corp.io/app")).toEqual(["secret.connection-string"]);
  });
  it("doesn't mistake a port and a path for a user and password", () => {
    expect(codes("https://example.acme-corp.io:8080/team/@someone")).toEqual([]);
    expect(codes("see https://medium.com:443/@writer/post")).toEqual([]);
  });
});

describe("findSecrets: private keys wrapped on short lines", () => {
  it("blocks a key whose lines are shorter than 40 characters", () => {
    const lines = fake(80).match(/.{1,26}/g)!.join("\n");
    expect(severities("-----BEGIN RSA PRIVATE KEY-----\n" + lines + "\n-----END RSA PRIVATE KEY-----")).toEqual(["secret.private-key:block"]);
  });
  it("blocks a key whose data starts on the header's own line, or after PEM header lines", () => {
    expect(codes("-----BEGIN PRIVATE KEY-----" + fake(60))).toEqual(["secret.private-key"]);
    expect(codes("-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,9F3A7C1E\n\n" + fake(32) + "\n" + fake(32))).toEqual(["secret.private-key"]);
  });
  it("only warns for a header followed by ordinary sentences", () => {
    expect(severities("The file starts with -----BEGIN RSA PRIVATE KEY----- and then lines of base64.\nNever commit one.")).toEqual(["secret.private-key-header:warn"]);
    expect(severities("-----BEGIN RSA PRIVATE KEY-----\nthis is only an example header line in the docs\n-----END RSA PRIVATE KEY-----")).toEqual(["secret.private-key-header:warn"]);
  });
});

describe("findSecrets: hidden characters can't split a secret, soft hyphen included", () => {
  it("still finds a token and an assignment with soft hyphens inside", () => {
    expect(codes("gh" + "p_" + fake(10) + "­" + fake(26))).toEqual(["secret.github-token"]);
    expect(codes("pass­word=" + fake(16))).toEqual(["secret.assignment"]);
  });
});

describe("findSecrets: a sequence like 123456 only marks a placeholder when it is most of the value", () => {
  it("blocks real-looking passwords that merely contain a sequence", () => {
    expect(blocks("password = 'Summer123456!'")).toBe(true);
    expect(blocks("password: Passw0rd123456")).toBe(true);
  });
  it("keeps stand-ins non-blocking", () => {
    for (const text of ["password: 123456", "token: abcdef123456", "api_key: xxxx123456"]) expect(blocks(text), text).toBe(false);
  });
  it("uses the same rule for provider keys", () => {
    expect(codes("gh" + "p_" + fake(30) + "123456")).toEqual(["secret.github-token"]);
    expect(codes("gh" + "p_" + "123456".repeat(6))).toEqual([]);
  });
  it("leaves a quoted value with spaces as a warning", () => {
    expect(severities('password: "Xk9 fQ2 mZp7 Lq"')).toEqual(["secret.assignment:warn"]);
  });
});
