// packages/server/src/cycles/plugins/index.ts
import type { LanguageGatePlugin } from "./types.js";
import { typescriptPlugin } from "./typescript.js";

export type { LanguageGatePlugin, GateCommand, GateCheckResult, GateCheckType } from "./types.js";

const plugins: Map<string, LanguageGatePlugin> = new Map();

export function registerPlugin(plugin: LanguageGatePlugin): void {
  plugins.set(plugin.language, plugin);
}

export function getPlugin(language: string): LanguageGatePlugin | undefined {
  return plugins.get(language);
}

/** Try each registered plugin's detect() and return the first match */
export async function detectLanguage(workspacePath: string): Promise<string | undefined> {
  for (const plugin of plugins.values()) {
    if (await plugin.detect(workspacePath)) {
      return plugin.language;
    }
  }
  return undefined;
}

// Register built-in plugins
registerPlugin(typescriptPlugin);
