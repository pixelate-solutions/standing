import { isSignatureError } from "http-message-sig";
import { parseSignatureAgentHeader, verify, type SignatureAgentEntry } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { randomId, sha256, type PublicJwk } from "./crypto.ts";
import { sql } from "./db.ts";
import { directoryIdentity, findDirectoryKey } from "./directory.ts";
import { env } from "./env.ts";

export type AgentRow = {
  id: string;
  account_id: string | null;
  name: string;
  directory_url: string | null;
  test_standing: string | null;
  revoked_at: Date | null;
};

export type Reason = { code: string; message: string };

export type Verification =
  | { status: "unsigned" }
  | { status: "verified"; agent: AgentRow; kid: string; expires: Date; replayKey: string }
  | { status: "unverified"; kid: string | null; reason: Reason }
  | { status: "invalid"; kid: string | null; agent: AgentRow | null; reason: Reason };

export type SignedRequest = { method: string; url: string; headers: Record<string, string> };

// Signatures older than this are rejected even if they have not expired.
const MAX_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

class ResolveError extends Error {
  constructor(
    readonly status: "unverified" | "invalid",
    readonly code: string,
    message: string,
    readonly agent: AgentRow | null = null,
  ) {
    super(message);
  }
}

export function agentHostLabel(agentId: string): string {
  return agentId.replace("_", "-");
}

export function agentIdFromHost(host: string): string | null {
  const suffix = `.${env.agentsHost}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  return /^agt-[a-z0-9]+$/.test(label) ? label.replace("-", "_") : null;
}

function isOurDirectory(entry: SignatureAgentEntry): boolean {
  try {
    return new URL(entry.uri).host.endsWith(`.${env.agentsHost}`);
  } catch {
    return false;
  }
}

async function registeredKey(kid: string): Promise<{ jwk: PublicJwk; agent: AgentRow; revoked: boolean } | null> {
  const [row] = await sql<(AgentRow & { jwk: PublicJwk; key_revoked_at: Date | null })[]>`
    select a.id, a.account_id, a.name, a.directory_url, a.test_standing, a.revoked_at, k.jwk, k.revoked_at as key_revoked_at
    from agent_keys k join agents a on a.id = k.agent_id where k.kid = ${kid}`;
  if (!row) return null;
  const { jwk, key_revoked_at, ...agent } = row;
  return { jwk, agent, revoked: key_revoked_at !== null };
}

async function directoryAgent(identity: string): Promise<AgentRow> {
  const name = new URL(identity).host;
  const [row] = await sql<AgentRow[]>`
    insert into agents (id, name, directory_url) values (${randomId("agt")}, ${name}, ${identity})
    on conflict (directory_url) do update set directory_url = excluded.directory_url
    returning id, account_id, name, directory_url, test_standing, revoked_at`;
  return row!;
}

// Web Bot Auth lets agents list more than one Signature-Agent. Use the one the
// signature label points at, else the first.
function signatureAgent(headers: Record<string, string>): SignatureAgentEntry | undefined {
  const raw = headers["signature-agent"];
  if (!raw) return undefined;
  return parseSignatureAgentHeader(raw).entries[0];
}

export async function verifyAgentRequest(input: SignedRequest, now = new Date()): Promise<Verification> {
  const headers = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (!headers["signature"] || !headers["signature-input"]) return { status: "unsigned" };

  let resolved: { agent: AgentRow; kid: string } | null = null;
  let kid: string | null = null;

  try {
    const request = new Request(input.url, { method: input.method, headers });
    const result = await verify(request, {
      maxAge: MAX_AGE_SECONDS,
      clockSkew: CLOCK_SKEW_SECONDS,
      now,
      resolver: async (candidate) => {
        kid = candidate.keyid;
        const registered = await registeredKey(candidate.keyid);
        if (registered) {
          if (registered.revoked) throw new ResolveError("invalid", "key_revoked", "This key was revoked by the agent's owner.", registered.agent);
          resolved = { agent: registered.agent, kid: candidate.keyid };
          return verifierFromJWK(registered.jwk);
        }

        const entry = candidate.signatureAgent ?? signatureAgent(headers);
        if (!entry || isOurDirectory(entry)) {
          throw new ResolveError("unverified", "unknown_key", "The signing key is not registered and no key directory was given.");
        }
        let jwk: PublicJwk | null;
        try {
          jwk = await findDirectoryKey(entry, candidate.keyid);
        } catch (error) {
          throw new ResolveError("unverified", "directory_unavailable", (error as Error).message);
        }
        if (!jwk) throw new ResolveError("unverified", "unknown_key", "The signing key is not in the agent's key directory.");
        resolved = { agent: await directoryAgent(directoryIdentity(entry)), kid: candidate.keyid };
        return verifierFromJWK(jwk);
      },
    });

    const { agent, kid: resolvedKid } = resolved as unknown as { agent: AgentRow; kid: string };
    const replayKey = sha256(result.nonce ? `${resolvedKid}:${result.nonce}` : `sig:${headers["signature"]}`);
    return { status: "verified", agent, kid: resolvedKid, expires: result.expires, replayKey };
  } catch (error) {
    const cause = isSignatureError(error) ? error.cause : error;
    if (cause instanceof ResolveError) {
      if (cause.status === "unverified") return { status: "unverified", kid, reason: { code: cause.code, message: cause.message } };
      return { status: "invalid", kid, agent: cause.agent, reason: { code: cause.code, message: cause.message } };
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = /expired/i.test(message) ? "signature_expired" : /too old|maxAge|created/i.test(message) ? "signature_stale" : "signature_invalid";
    const agent = (resolved as { agent: AgentRow } | null)?.agent ?? null;
    return { status: "invalid", kid, agent, reason: { code, message } };
  }
}
