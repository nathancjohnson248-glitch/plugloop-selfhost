import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          ADMIN_PASSWORD: "correct horse battery",
          STRIPE_WEBHOOK_SECRET: "whsec_c3RyaXBlLXRlc3Qtc2VjcmV0",
          POLAR_WEBHOOK_SECRET: "whsec_cG9sYXItdGVzdC1zZWNyZXQtMTIz",
          LEMONSQUEEZY_WEBHOOK_SECRET: "ls-test-secret-0123456789",
          DODO_WEBHOOK_SECRET: "whsec_ZG9kby10ZXN0LXNlY3JldC00NTY=",
          PADDLE_WEBHOOK_SECRET: "pdl_ntfset_test_secret",
        },
      },
    })),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
