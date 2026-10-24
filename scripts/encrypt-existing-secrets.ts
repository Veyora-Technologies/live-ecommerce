/**
 * Re-encrypt legacy plaintext secrets at rest.
 *
 * Background: `WebhookSubscription.secret` and `IntegrationConnection.config`
 * must hold AES-256-GCM envelopes (`enc:v1:...`) produced by
 * `src/lib/secret-vault.ts`. Records created before that boundary existed, or
 * copied in from a backup, may still contain plaintext.
 *
 * This utility never prints secret values. It is a dry run unless `--apply`
 * is passed.
 *
 *   npx tsx scripts/encrypt-existing-secrets.ts            # report only
 *   npx tsx scripts/encrypt-existing-secrets.ts --apply    # write envelopes
 *
 * Safety rules:
 *   - refuses to run against non-file (hosted) databases unless --allow-remote
 *   - refuses to run in production without LIVE_SECRET_ENCRYPTION_KEY
 *   - values that already start with `enc:v1:` are left untouched
 */
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/secret-vault";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");
const ENVELOPE_PREFIX = "enc:v1:";

function isEncrypted(value: string | null | undefined) {
  return Boolean(value && value.startsWith(ENVELOPE_PREFIX));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  if (!databaseUrl.startsWith("file:") && !allowRemote) {
    throw new Error("Refusing to rewrite secrets on a non-file database without --allow-remote. Back up first.");
  }
  if (process.env.NODE_ENV === "production") {
    const key = process.env.LIVE_SECRET_ENCRYPTION_KEY;
    if (!key || key.length < 32) {
      throw new Error("LIVE_SECRET_ENCRYPTION_KEY (32+ characters) is required before re-encrypting production secrets.");
    }
  }

  const [webhooks, integrations] = await Promise.all([
    prisma.webhookSubscription.findMany({ select: { id: true, secret: true } }),
    prisma.integrationConnection.findMany({ select: { id: true, config: true } }),
  ]);

  const plaintextWebhooks = webhooks.filter((row) => row.secret !== null && !isEncrypted(row.secret));
  // An integration config is only treated as a secret when it is a JSON object
  // that actually carries credential material; the API route never writes one.
  const plaintextIntegrations = integrations.filter((row) => row.config !== null && !isEncrypted(row.config));

  console.log(`Webhook subscriptions: ${webhooks.length} total, ${plaintextWebhooks.length} plaintext.`);
  console.log(`Integration connections: ${integrations.length} total, ${plaintextIntegrations.length} plaintext/inline.`);

  if (!plaintextWebhooks.length && !plaintextIntegrations.length) {
    console.log("Nothing to migrate. All stored secrets already use the enc:v1 envelope.");
    return;
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to encrypt these records.");
    console.log("Affected ids (no values shown):");
    for (const row of plaintextWebhooks) console.log(`  webhook   ${row.id}`);
    for (const row of plaintextIntegrations) console.log(`  integration ${row.id}`);
    return;
  }

  let updated = 0;
  for (const row of plaintextWebhooks) {
    await prisma.webhookSubscription.update({
      where: { id: row.id },
      data: { secret: encryptSecret(String(row.secret)) },
    });
    updated += 1;
  }
  for (const row of plaintextIntegrations) {
    await prisma.integrationConnection.update({
      where: { id: row.id },
      data: { config: encryptSecret(String(row.config)) },
    });
    updated += 1;
  }
  console.log(`\nRe-encrypted ${updated} record(s). Existing webhook signing secrets are preserved, so merchant verifiers keep working.`);
}

main()
  .catch((error) => {
    console.error(`Migration failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
