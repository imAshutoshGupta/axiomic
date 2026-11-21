import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptText, encryptText, parseKeyring, ruleVersionAad, suggestionAad, type Keyring } from "../src/crypto";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ring = (cur = "1"): Keyring => parseKeyring(JSON.stringify({ "1": k1, "2": k2 }), cur);
const aad = (v: number) => ruleVersionAad("r1", 1, v);

describe("parseKeyring", () => {
  it("reads keys and the current version", () => {
    const r = ring("2");
    expect(r.current).toBe(2);
    expect(r.keys.size).toBe(2);
  });
  it.each([
    [undefined, "1"],
    ["not json", "1"],
    ["[]", "1"],
    [JSON.stringify({ "1": "short" }), "1"],
    [JSON.stringify({ "0": k1 }), "0"],
    [JSON.stringify({ "01": k1 }), "1"],
    [JSON.stringify({ "1": k1 }), "2"],
    [JSON.stringify({ "1": k1 }), undefined],
    [JSON.stringify({ "1": 5 }), "1"],
  ])("refuses bad config %#", (keys, cur) => {
    expect(() => parseKeyring(keys, cur)).toThrow();
  });
  it("never puts key material in error messages", () => {
    try {
      parseKeyring(JSON.stringify({ "1": k1 }), "3");
    } catch (e) {
      expect(String(e)).not.toContain(k1);
    }
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips text, including non-ASCII", () => {
    const text = "Use tabs. नमस्ते 🚀\n```js\nx\n```";
    const s = encryptText(ring(), text, aad);
    expect(s.keyVersion).toBe(1);
    expect(s.nonce.length).toBe(12);
    expect(s.ciphertext.length).toBe(Buffer.byteLength(text) + 16);
    expect(decryptText(ring(), s, aad(1))).toBe(text);
  });
  it("uses a fresh nonce every time", () => {
    const a = encryptText(ring(), "same", aad);
    const b = encryptText(ring(), "same", aad);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });
  it("encrypts with the current key and still opens old versions", () => {
    const old = encryptText(ring("1"), "old", aad);
    const neu = encryptText(ring("2"), "new", aad);
    expect(neu.keyVersion).toBe(2);
    expect(decryptText(ring("2"), old, aad(1))).toBe("old");
  });
  it("fails if the text is moved to another row (AAD)", () => {
    const s = encryptText(ring(), "x", aad);
    expect(() => decryptText(ring(), s, ruleVersionAad("r2", 1, 1))).toThrow(/decryption failed/);
    expect(() => decryptText(ring(), s, ruleVersionAad("r1", 2, 1))).toThrow();
    expect(() => decryptText(ring(), s, suggestionAad("r1", 1))).toThrow();
  });
  it("fails if one byte is changed", () => {
    const s = encryptText(ring(), "hello", aad);
    s.ciphertext[0] = s.ciphertext[0]! ^ 1;
    expect(() => decryptText(ring(), s, aad(1))).toThrow();
  });
  it("fails with the wrong key", () => {
    const s = encryptText(ring(), "hello", aad);
    const other = parseKeyring(JSON.stringify({ "1": k2 }), "1");
    expect(() => decryptText(other, s, aad(1))).toThrow();
  });
  it("fails clearly on an unknown key version or placeholder bytes", () => {
    expect(() => decryptText(ring(), { nonce: Buffer.alloc(12), ciphertext: Buffer.alloc(20), keyVersion: 9 }, "a")).toThrow(/no key/);
    expect(() =>
      decryptText(ring(), { nonce: Buffer.alloc(12), ciphertext: Buffer.from("PLACEHOLDER: x"), keyVersion: 1 }, "a"),
    ).toThrow();
  });
});
