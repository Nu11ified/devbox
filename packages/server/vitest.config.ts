import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anthropic-ai/claude-code": "/dev/null",
    },
  },
});
