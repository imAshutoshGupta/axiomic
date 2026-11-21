import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CredentialsError, credentialsPath, deleteCredentials, readCredentials, writeCredentials, type Credentials } from "../../src/server/credentials";
import { POSIX, listAll, makeTempDir, modeOf } from "../helpers/test-helpers";

const SECRET = "axm_SECRET-token-1234567890";
const creds: Credentials = { schemaVersion: 1, token: SECRET, apiUrl: "https://axiomic.vercel.app" };

describe("credentials file", () => {
  it("round-trips, with an owner-only folder and file and no temp file left behind", async () => {
    const config = path.join(await makeTempDir(), "nested", "axiomic");
    expect(await readCredentials(config)).toBeUndefined();
    await writeCredentials(config, creds);
    expect(await readCredentials(config)).toEqual(creds);
    expect(await listAll(config)).toEqual(["credentials.json"]);
    if (POSIX) {
      expect(await modeOf(config)).toBe(0o700);
      expect(await modeOf(credentialsPath(config))).toBe(0o600);
    }
  });

  it("tightens an existing folder that was too open", async () => {
    const config = await makeTempDir();
    await fs.chmod(config, 0o755);
    await writeCredentials(config, creds);
    if (POSIX) expect(await modeOf(config)).toBe(0o700);
  });

  it.skipIf(!POSIX)("refuses a file other users can read, without printing the token", async () => {
    const config = await makeTempDir();
    await writeCredentials(config, creds);
    await fs.chmod(credentialsPath(config), 0o644);
    const error = await readCredentials(config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialsError);
    expect((error as Error).message).toContain("chmod 600");
    expect((error as Error).message).not.toContain(SECRET);
  });

  it("refuses a symlinked credentials file", async () => {
    const config = await makeTempDir();
    const elsewhere = path.join(await makeTempDir(), "real.json");
    await fs.writeFile(elsewhere, JSON.stringify(creds), { mode: 0o600 });
    await fs.symlink(elsewhere, credentialsPath(config));
    await expect(readCredentials(config)).rejects.toBeInstanceOf(CredentialsError);
  });

  it.each([
    ["not json", "{"],
    ["an array", "[]"],
    ["an extra field", JSON.stringify({ ...creds, extra: 1 })],
    ["a missing token", JSON.stringify({ schemaVersion: 1, apiUrl: creds.apiUrl })],
    ["a wrong schemaVersion", JSON.stringify({ ...creds, schemaVersion: 2 })],
    ["a token with a line break", JSON.stringify({ ...creds, token: "a\r\nX-Evil: 1" })],
    ["an http server", JSON.stringify({ ...creds, apiUrl: "http://evil.example.com" })],
  ])("rejects %s and never echoes the content", async (_name, text) => {
    const config = await makeTempDir();
    await fs.writeFile(credentialsPath(config), text, { mode: 0o600 });
    const error = (await readCredentials(config).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(CredentialsError);
    expect(error.message).not.toContain(SECRET);
  });

  it("refuses to save invalid credentials", async () => {
    const config = await makeTempDir();
    await expect(writeCredentials(config, { ...creds, token: "has space" })).rejects.toBeInstanceOf(CredentialsError);
    expect(await listAll(config)).toEqual([]);
  });

  it("deletes the file, and only reports true if there was one", async () => {
    const config = await makeTempDir();
    await writeCredentials(config, creds);
    expect(await deleteCredentials(config)).toBe(true);
    expect(await deleteCredentials(config)).toBe(false);
  });
});
