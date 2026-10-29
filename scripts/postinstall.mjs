#!/usr/bin/env node
/**
 * Post-install Prisma Client generation.
 *
 * `prisma` (the CLI) is a devDependency while `@prisma/client` is a runtime
 * dependency. A production install (`npm ci --omit=dev`) therefore has no CLI,
 * so a naive `postinstall: prisma generate` makes that install fail. This script
 * generates the client when the CLI is present and explains what to do when it
 * is not — it never silently pretends the client exists.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = join(repoRoot, "node_modules", "prisma", "build", "index.js");
const generatedClient = join(repoRoot, "node_modules", ".prisma", "client", "index.js");

if (!existsSync(prismaCli)) {
  console.warn(
    "[postinstall] Prisma CLI not installed (production install). " +
      (existsSync(generatedClient)
        ? "An already-generated client was found."
        : "Generate it during the build stage with `npx prisma generate` before deploying."),
  );
  process.exit(0);
}

const result = spawnSync(process.execPath, [prismaCli, "generate"], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error("[postinstall] `prisma generate` failed. The app cannot start without a generated client.");
  process.exit(result.status ?? 1);
}
