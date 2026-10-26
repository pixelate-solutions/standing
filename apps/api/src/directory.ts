import { HTTP_MESSAGE_SIGNATURES_DIRECTORY, type SignatureAgentEntry } from "web-bot-auth";
import { isEd25519PublicJwk, thumbprint, type PublicJwk } from "./crypto.ts";
import { fetchPublic } from "./network.ts";

const CACHE_MS = 5 * 60_000;
const FAILURE_CACHE_MS = 60_000;
const MAX_KEYS = 20;

type CacheEntry = { expires: number; keys: PublicJwk[] | null; error?: string };
const cache = new Map<string, CacheEntry>();

// The identity of a self-hosted agent is the URL its keys are published at.
export function directoryIdentity(entry: SignatureAgentEntry): string {
  if (entry.type === "directory") return new URL(entry.uri).origin;
  return entry.uri;
}

function directoryUrl(entry: SignatureAgentEntry): URL {
  if (entry.type === "directory") return new URL(HTTP_MESSAGE_SIGNATURES_DIRECTORY, new URL(entry.uri).origin);
  if (entry.type === "jwks_uri") return new URL(entry.uri);
  throw new Error(`Signature-Agent type ${entry.type} is not supported`);
}

export async function findDirectoryKey(entry: SignatureAgentEntry, kid: string): Promise<PublicJwk | null> {
  const url = directoryUrl(entry).toString();
  const now = Date.now();
  let cached = cache.get(url);
  if (!cached || cached.expires < now) {
    try {
      const body = JSON.parse(await fetchPublic(new URL(url), { accept: "application/http-message-signatures-directory+json, application/json" }));
      const keys = Array.isArray(body?.keys) ? body.keys.filter(isEd25519PublicJwk).slice(0, MAX_KEYS) : [];
      cached = { expires: now + CACHE_MS, keys: keys.map((k: PublicJwk) => ({ kty: k.kty, crv: k.crv, x: k.x })) };
    } catch (error) {
      cached = { expires: now + FAILURE_CACHE_MS, keys: null, error: (error as Error).message };
    }
    cache.set(url, cached);
  }
  if (!cached.keys) throw new Error(`Key directory unavailable: ${cached.error}`);
  return cached.keys.find((k) => thumbprint(k) === kid) ?? null;
}

export function clearDirectoryCache() {
  cache.clear();
}
