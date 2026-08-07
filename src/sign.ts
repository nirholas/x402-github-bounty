import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const DEV_SECRET = "x402-github-bounty-dev-secret-change-me";
const secret = process.env.SIGNING_SECRET || DEV_SECRET;

if (secret === DEV_SECRET) {
  console.warn(
    "WARN: using the default dev SIGNING_SECRET — set SIGNING_SECRET in production so certificates are unforgeable.",
  );
}

/** Deterministic JSON: keys sorted recursively so signatures are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** HMAC-SHA256 over canonical JSON. */
export function sign(payload: unknown): string {
  return createHmac("sha256", secret).update(canonicalJson(payload)).digest("hex");
}

/** Verify a signature produced by sign(). */
export function verify(payload: unknown, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature || "", "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** SHA-256 hex digest — used to store settle keys without keeping the secret. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
