export type Env = {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Dashboard password. Optional: without it the first visitor to /setup picks one. */
  ADMIN_PASSWORD?: string;
  /** Optional cookie-signing key. Without it a random key is generated and kept in D1. */
  SESSION_SECRET?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  POLAR_WEBHOOK_SECRET?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  DODO_WEBHOOK_SECRET?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  CURRENCY?: string;
  RETENTION_DAYS?: string;
  INCLUDE_TEST_SALES?: string;
};

export type AppEnv = { Bindings: Env };
