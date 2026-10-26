import type { Check, Decision, Outcome, StandingError } from "./types.ts";

export type * from "./types.ts";

export type StandingOptions = {
  /** A business API key: sd_test_... or sd_live_... */
  apiKey: string;
  baseUrl?: string;
  /** Give up on Standing after this long and fall back. Default 2000 ms. */
  timeoutMs?: number;
  /** When Standing is unreachable, deny instead of allow. Default false. */
  failClosed?: boolean;
};

export type CheckResult = Check & {
  /** True when your policy is enforcing and the decision is not "allow". */
  blocked: boolean;
  error: null;
};

/** Returned when Standing could not be reached or rejected the call. */
export type CheckFailure = {
  id: null;
  decision: Decision;
  enforced: boolean;
  blocked: boolean;
  error: StandingError;
};

type HeaderSource = Headers | Record<string, string | string[] | undefined>;
export type RequestLike = Request | { method: string; url: string; headers: HeaderSource };

const SIGNATURE_HEADERS = ["signature", "signature-input", "signature-agent"];

function getHeader(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value;
}

/** True if the request carries a Web Bot Auth / HTTP Message Signature. */
export function isSignedRequest(request: RequestLike): boolean {
  return Boolean(getHeader(request.headers, "signature") && getHeader(request.headers, "signature-input"));
}

/**
 * Only the headers the agent actually signed are sent to Standing, never
 * cookies or authorization headers.
 */
export function signedHeaders(request: RequestLike): Record<string, string> {
  const input = getHeader(request.headers, "signature-input") ?? "";
  const covered = [...input.matchAll(/(?<=[(\s])"([^"@][^"]*)"/g)].map((m) => m[1]!.toLowerCase());
  const out: Record<string, string> = {};
  for (const name of new Set([...SIGNATURE_HEADERS, ...covered])) {
    if (name === "cookie" || name === "authorization") continue;
    const value = getHeader(request.headers, name);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export class Standing {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #failClosed: boolean;

  constructor(options: StandingOptions) {
    if (!options.apiKey?.startsWith("sd_")) throw new Error("Standing: apiKey must start with sd_test_ or sd_live_");
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.standing.dev").replace(/\/$/, "");
    this.#timeoutMs = options.timeoutMs ?? 2000;
    this.#failClosed = options.failClosed ?? false;
  }

  async #call<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const json = (await response.json().catch(() => null)) as { error?: StandingError } | null;
    if (!response.ok) throw Object.assign(new Error(json?.error?.message ?? `Standing returned ${response.status}`), { code: json?.error?.code ?? "http_error" });
    return json as T;
  }

  /**
   * Check a signed agent request. Returns null for requests with no
   * signature: those are not agents identifying themselves.
   */
  async check(request: RequestLike, options: { action?: string } = {}): Promise<CheckResult | CheckFailure | null> {
    if (!isSignedRequest(request)) return null;
    try {
      const check = await this.#call<Check>("/v1/checks", {
        method: request.method,
        url: request.url,
        headers: signedHeaders(request),
        action: options.action,
      });
      return { ...check, blocked: check.enforced && check.decision !== "allow", error: null };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        id: null,
        decision: this.#failClosed ? "deny" : "allow",
        enforced: this.#failClosed,
        blocked: this.#failClosed,
        error: { code: err.name === "TimeoutError" ? "timeout" : (err.code ?? "unreachable"), message: err.message },
      };
    }
  }

  /** Tell the network how an interaction ended. You can update it later, e.g. on a chargeback. */
  report(checkId: string, outcome: Outcome, options: { reference?: string } = {}): Promise<Check> {
    return this.#call<Check>(`/v1/checks/${encodeURIComponent(checkId)}/outcome`, { outcome, reference: options.reference });
  }

  /**
   * Express / Node middleware. Sets `req.standing` and, when the policy is
   * enforcing, answers challenged (401) and denied (403) agents itself.
   */
  middleware(options: { action?: string; respond?: boolean } = {}) {
    const respond = options.respond ?? true;
    return async (
      req: { method: string; originalUrl?: string; url?: string; headers: HeaderSource; protocol?: string; get?: (name: string) => string | undefined; standing?: unknown },
      res: { status: (code: number) => { json: (body: unknown) => void } },
      next: (error?: unknown) => void,
    ) => {
      try {
        const host = getHeader(req.headers, "host") ?? "localhost";
        const url = `${req.protocol ?? "https"}://${host}${req.originalUrl ?? req.url ?? "/"}`;
        const result = await this.check({ method: req.method, url, headers: req.headers }, options);
        req.standing = result;
        if (respond && result?.blocked) {
          const status = result.decision === "challenge" ? 401 : 403;
          const reason = "reasons" in result ? result.reasons.at(-1) : result.error;
          res.status(status).json({ error: { code: `agent_${result.decision}`, message: reason?.message ?? "Agent not allowed.", check_id: result.id } });
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
    };
  }
}
