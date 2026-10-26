import { generateNonce, sign } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";

/** The key file you download when you create an agent. Keep it secret. */
export type AgentKey = {
  agent_id: string;
  /** Origin of the agent's public key directory. */
  directory: string;
  private_key: JsonWebKey;
};

export type SignOptions = {
  /** Signature lifetime. Short lifetimes limit replay. Default 60 s. */
  expiresInSeconds?: number;
};

function parseKey(value: string | AgentKey): AgentKey {
  const key = typeof value === "string" ? (JSON.parse(value) as AgentKey) : value;
  if (!key?.agent_id || !key.directory || key.private_key?.crv !== "Ed25519" || !key.private_key.d) {
    throw new Error("Standing: not an agent key. Expected { agent_id, directory, private_key } with an Ed25519 private JWK.");
  }
  return key;
}

/**
 * Sign a request as your agent using Web Bot Auth (RFC 9421 HTTP Message
 * Signatures). Returns a new Request with Signature, Signature-Input and
 * Signature-Agent headers.
 */
export async function signRequest(request: Request, agentKey: string | AgentKey, options: SignOptions = {}): Promise<Request> {
  const key = parseKey(agentKey);
  const headers = new Headers(request.headers);
  headers.set("signature-agent", `sig1="${key.directory}";type=directory`);
  const now = new Date();
  const fields = await sign(new Request(request.url, { method: request.method, headers }), {
    signer: await signerFromJWK(key.private_key),
    created: now,
    expires: new Date(now.getTime() + (options.expiresInSeconds ?? 60) * 1000),
    nonce: generateNonce(),
  });
  headers.set("signature", fields.signature);
  headers.set("signature-input", fields.signatureInput);
  return new Request(request, { headers, duplex: "half" } as RequestInit);
}

/** A drop-in `fetch` that signs every request as your agent. */
export function createAgentFetch(agentKey: string | AgentKey, options: SignOptions = {}): typeof fetch {
  const key = parseKey(agentKey);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return fetch(await signRequest(request, key, options));
  }) as typeof fetch;
}

const toBase64Url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Generate a new Ed25519 key pair for an agent. */
export async function generateAgentKeyPair(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: { kty: "OKP", crv: "Ed25519", x: privateKey.x }, privateKey: { kty: "OKP", crv: "Ed25519", x: privateKey.x, d: privateKey.d } };
}

/**
 * Proof that you hold the private key, required when registering it. Signs
 * `standing-key-proof:<account_id>:<x>`.
 */
export async function proveKey(accountId: string, privateKey: JsonWebKey): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", { ...privateKey, key_ops: ["sign"] }, { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(`standing-key-proof:${accountId}:${privateKey.x}`));
  return toBase64Url(signature);
}
