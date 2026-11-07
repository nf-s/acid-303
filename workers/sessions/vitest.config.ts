import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest({ config: "./cloudflare.config.ts" })],
  test: { include: ["test/**/*.test.ts"], testTimeout: 15000 },
});
