import { createHash, createPublicKey, randomBytes, scrypt, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(prefix: string, length = 20): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

export type PublicJwk = { kty: "OKP"; crv: "Ed25519"; x: string };

// RFC 7638 thumbprint of an Ed25519 public key. This is the keyid agents put
// in Signature-Input.
export function thumbprint(jwk: PublicJwk): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return createHash("sha256").update(canonical).digest("base64url");
}

export function isEd25519PublicJwk(value: unknown): value is PublicJwk {
  if (!value || typeof value !== "object") return false;
  const jwk = value as Record<string, unknown>;
  return jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string" && /^[A-Za-z0-9_-]{43}$/.test(jwk.x);
}

// Proof that whoever registers a key holds its private half, so nobody can
// claim another agent's public key (and its standing).
export function proofMessage(accountId: string, jwk: PublicJwk): string {
  return `standing-key-proof:${accountId}:${jwk.x}`;
}

export function verifyProof(accountId: string, jwk: PublicJwk, proof: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
    return verifySignature(null, Buffer.from(proofMessage(accountId, jwk)), key, Buffer.from(proof, "base64url"));
  } catch {
    return false;
  }
}
