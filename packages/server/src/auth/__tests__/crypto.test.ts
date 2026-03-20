import { describe, it, expect } from "bun:test";
import { deriveUserKey, encrypt, decrypt } from "../crypto.js";

describe("deriveUserKey", () => {
  const masterKey = Buffer.from("a".repeat(64), "hex"); // 32 bytes

  it("derives a 32-byte key", async () => {
    const key = await deriveUserKey(masterKey, "user-123");
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("derives different keys for different users", async () => {
    const key1 = await deriveUserKey(masterKey, "user-1");
    const key2 = await deriveUserKey(masterKey, "user-2");
    expect(key1.equals(key2)).toBe(false);
  });

  it("derives the same key for the same user (deterministic)", async () => {
    const key1 = await deriveUserKey(masterKey, "user-1");
    const key2 = await deriveUserKey(masterKey, "user-1");
    expect(key1.equals(key2)).toBe(true);
  });

  it("derived key works with encrypt/decrypt", async () => {
    const key = await deriveUserKey(masterKey, "user-1");
    const data = encrypt("secret-api-key", key);
    const result = decrypt(data, key);
    expect(result).toBe("secret-api-key");
  });
});
