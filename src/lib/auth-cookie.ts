/**
 * The session cookie name.
 *
 * Lives in its own module with no dependencies so that pure logic (cache
 * safety, request classification) can reason about sessions without importing
 * `auth.ts`, which constructs a Prisma client at module load.
 *
 * The value is deliberately `live_token`: renaming a cookie signs every existing
 * user out, and this constant is the single place that decision lives.
 */
export const AUTH_COOKIE = "live_token";
