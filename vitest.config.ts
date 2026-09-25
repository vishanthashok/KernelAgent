import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    env: { OTEL_SDK_DISABLED: "true", LLM_PROVIDER: "mock", SANDBOX_PROVIDER: "local" },
  },
});
