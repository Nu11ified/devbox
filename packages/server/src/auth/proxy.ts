import { encrypt, decrypt, type EncryptedData } from "./crypto.js";
import type { SidecarClient } from "../agents/backend.js";
import prisma from "../db/prisma.js";

interface StoredToken {
  data: EncryptedData;
  storedAt: number;
}

export class AuthProxy {
  private tokens = new Map<string, StoredToken>();

  constructor(private encryptionKey: Buffer) {}

  async storeToken(provider: "claude" | "codex", token: string): Promise<void> {
    const data = encrypt(token, this.encryptionKey);
    this.tokens.set(provider, { data, storedAt: Date.now() });
  }

  async getToken(provider: "claude" | "codex"): Promise<string | null> {
    const stored = this.tokens.get(provider);
    if (!stored) return null;
    return decrypt(stored.data, this.encryptionKey);
  }

  async removeToken(provider: string): Promise<boolean> {
    return this.tokens.delete(provider);
  }

  listProviders(): string[] {
    return Array.from(this.tokens.keys());
  }

  async injectIntoContainer(
    containerId: string,
    provider: string,
    sidecar: SidecarClient
  ): Promise<void> {
    const token = await this.getToken(provider as "claude" | "codex");
    if (!token) {
      throw new Error(`No token stored for provider: ${provider}`);
    }

    const envKey = provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    const envContent = `${envKey}=${token}\n`;
    await sidecar.writeFile("/workspace/.env.patchwork", envContent);
  }

  async injectGitHubToken(
    userId: string,
    sidecar: SidecarClient
  ): Promise<void> {
    const account = await prisma.account.findFirst({
      where: { userId, providerId: "github" },
    });
    if (!account?.accessToken) {
      throw new Error("No GitHub token found for user");
    }
    const envContent = `GITHUB_TOKEN=${account.accessToken}\n`;
    await sidecar.writeFile("/workspace/.env.patchwork", envContent);
  }

  async checkExpiry(provider: string): Promise<{ valid: boolean; expiresIn?: number }> {
    const stored = this.tokens.get(provider);
    if (!stored) {
      return { valid: false };
    }
    // Tokens don't have intrinsic expiry in this implementation;
    // they are valid as long as they're stored. External validation
    // (e.g., calling the provider API) would be added here.
    return { valid: true };
  }
}
