/**
 * Request correlation.
 *
 * `src/proxy.ts` mints an id for every inbound request and forwards it as
 * `x-request-id`; handlers echo it back on the response. The same id appears in
 * server logs, so a user can quote "reference 3f2c…" and an operator can find
 * the exact failure without the user having to describe the page or paste
 * personal data into a support message.
 *
 * The only job of this module is to read that header safely. It never invents a
 * value when one is already present, and it rejects anything that is not a
 * short, opaque token so a caller cannot inject newlines or markup into logs.
 */

const HEADER = "x-request-id";

/** Conservative shape: what `crypto.randomUUID()` and our proxy produce. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

function newId(): string {
  // `crypto.randomUUID` exists in Node 19+ and every modern runtime. The
  // fallback keeps older deploy targets working without pulling in a dependency.
  const maybeCrypto = globalThis.crypto as Crypto | undefined;
  if (maybeCrypto?.randomUUID) return maybeCrypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read the correlation id from headers, minting one if the request did not
 * arrive through the proxy (unit tests, direct handler calls).
 */
export function requestIdFrom(headers: Headers | undefined | null): string {
  const inbound = headers?.get(HEADER)?.trim();
  return inbound && SAFE_ID.test(inbound) ? inbound : newId();
}

/** Generate an id with no inbound request, e.g. for background work. */
export function newRequestId(): string {
  return newId();
}

export const REQUEST_ID_HEADER = HEADER;
