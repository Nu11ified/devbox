import { createCipheriv, createDecipheriv, randomBytes, createHash, hkdf } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedData {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return { encrypted, iv: iv.toString("hex"), tag };
}

export function decrypt(data: EncryptedData, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(data.iv, "hex"));
  decipher.setAuthTag(Buffer.from(data.tag, "hex"));
  let decrypted = decipher.update(data.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Derive a per-user encryption key from the master key using HKDF-SHA256.
 * Each user gets a unique key so compromising one doesn't expose others.
 */
export async function deriveUserKey(masterKey: Buffer, userId: string): Promise<Buffer> {
  const salt = createHash("sha256").update(userId).digest();
  return new Promise<Buffer>((resolve, reject) => {
    hkdf("sha256", masterKey, salt, "patchwork-provider-credential", 32, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(Buffer.from(derivedKey));
    });
  });
}
