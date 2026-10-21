import { z } from "zod";

/** Fail-closed environment validation. Never fall back to a dev secret. */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  NODE_ENV: z.string().optional(),
  LIVE_DATA_MODE: z.enum(["demo", "production"]).optional(),
});

// This repository still has a SQLite-only Prisma datasource, no production migration history,
// and no verified production deployment profile. Re-enable only after those release gates pass.
const PRODUCTION_DATA_MODE_ENABLED = false;

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Do not leak values — only names of invalid variables.
    const fields = parsed.error.issues.map(i => String(i.path[0])).join(", ");
    throw new Error(`Invalid environment configuration (${fields}). See .env.example.`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_SECRET.length < 32) {
    throw new Error("Invalid environment configuration (JWT_SECRET must be 32+ chars in production).");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.LIVE_DATA_MODE === "production" && !PRODUCTION_DATA_MODE_ENABLED) {
    throw new Error("Invalid environment configuration (LIVE_DATA_MODE=production is blocked until a production database/provider, reviewed migrations, and operational release gates are verified).");
  }
  cached = parsed.data;
  return cached;
}

export function isProd() { return process.env.NODE_ENV === "production"; }

/** Non-throwing config status for health/metrics (names only, never values). */
export function getEnvStatus() {
  const parsed = schema.safeParse(process.env);
  const errors = parsed.success ? [] : parsed.error.issues.map(i => String(i.path[0]));
  if (parsed.success && parsed.data.NODE_ENV === "production" && parsed.data.JWT_SECRET.length < 32) {
    errors.push("JWT_SECRET");
  }
  if (parsed.success && parsed.data.NODE_ENV === "production" && parsed.data.LIVE_DATA_MODE === "production" && !PRODUCTION_DATA_MODE_ENABLED) {
    errors.push("LIVE_DATA_MODE");
  }
  return {
    valid: errors.length === 0,
    errors,
    integrations: {
      email: !!process.env.RESEND_API_KEY,
      sms: !!process.env.TWILIO_ACCOUNT_SID,
      vision: !!(process.env.VISION_PROVIDER && process.env.VISION_API_KEY),
      payments: !!(process.env.PAYSTACK_SECRET_KEY || process.env.STRIPE_SECRET_KEY),
      maps: !!process.env.MAPBOX_TOKEN,
      Sentry: !!process.env.SENTRY_DSN,
      cron: !!process.env.CRON_SECRET,
    },
  };
}
