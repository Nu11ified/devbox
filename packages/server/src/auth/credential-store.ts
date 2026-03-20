import prisma from "../db/prisma.js";
import { encrypt, decrypt, type EncryptedData } from "./crypto.js";
import { deriveUserKey } from "./crypto.js";

export type DecryptedCredential =
  | { type: "api_key"; apiKey: string }
  | { type: "oauth"; files: Record<string, Buffer> };

export interface ProviderStatus {
  connected: boolean;
  authMethod?: string;
  lastUsedAt?: Date | null;
  status?: string;
}

export class CredentialStore {
  constructor(private masterKey: Buffer) {}

  async storeApiKey(userId: string, provider: string, apiKey: string): Promise<void> {
    const userKey = await deriveUserKey(this.masterKey, userId);
    const { encrypted, iv, tag } = encrypt(apiKey, userKey);

    await prisma.providerCredential.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "api_key",
        status: "active",
      },
      update: {
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "api_key",
        status: "active",
      },
    });
  }

  async storeOAuthCredentials(
    userId: string,
    provider: string,
    files: Record<string, Buffer>,
  ): Promise<void> {
    const userKey = await deriveUserKey(this.masterKey, userId);
    const fileMap: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      fileMap[path] = content.toString("base64");
    }
    const plaintext = JSON.stringify({ files: fileMap });
    const { encrypted, iv, tag } = encrypt(plaintext, userKey);

    await prisma.providerCredential.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "oauth",
        status: "active",
      },
      update: {
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "oauth",
        status: "active",
      },
    });
  }

  async getCredential(userId: string, provider: string) {
    return prisma.providerCredential.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  }

  async decryptCredential(
    userId: string,
    provider: string,
  ): Promise<DecryptedCredential | null> {
    const cred = await this.getCredential(userId, provider);
    if (!cred || cred.status !== "active") return null;

    const userKey = await deriveUserKey(this.masterKey, userId);
    const encData: EncryptedData = {
      encrypted: Buffer.from(cred.credentialData).toString("hex"),
      iv: cred.encryptionIv,
      tag: cred.encryptionTag,
    };
    const plaintext = decrypt(encData, userKey);

    // Fire-and-forget lastUsedAt update
    prisma.providerCredential.update({
      where: { id: cred.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    if (cred.authMethod === "api_key") {
      return { type: "api_key", apiKey: plaintext };
    }

    const parsed = JSON.parse(plaintext) as { files: Record<string, string> };
    const files: Record<string, Buffer> = {};
    for (const [path, b64] of Object.entries(parsed.files)) {
      files[path] = Buffer.from(b64, "base64");
    }
    return { type: "oauth", files };
  }

  async getProviderStatus(
    userId: string,
  ): Promise<Record<string, ProviderStatus>> {
    const creds = await prisma.providerCredential.findMany({
      where: { userId },
    });

    const status: Record<string, ProviderStatus> = {
      claude: { connected: false },
      codex: { connected: false },
    };

    for (const cred of creds) {
      status[cred.provider] = {
        connected: cred.status === "active",
        authMethod: cred.authMethod,
        lastUsedAt: cred.lastUsedAt,
        status: cred.status,
      };
    }

    return status;
  }

  async revokeCredential(userId: string, provider: string): Promise<void> {
    await prisma.providerCredential.deleteMany({
      where: { userId, provider },
    });
  }

  async markExpired(userId: string, provider: string): Promise<void> {
    await prisma.providerCredential.updateMany({
      where: { userId, provider },
      data: { status: "expired" },
    });
  }
}
