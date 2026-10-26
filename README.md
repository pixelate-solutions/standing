# Standing

A shared record of how AI agents behave. Sites check an agent before trusting it and report how the interaction ended; every other site sees the result.

- **Agents** sign requests with [Web Bot Auth](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/) (RFC 9421 HTTP Message Signatures). Agents that already sign for Cloudflare work unchanged.
- **Sites** send the signature headers to `POST /v1/checks` and get `allow | challenge | deny`, the owner, and the agent's standing.
- **Sites report outcomes** (`completed`, `disputed`, `fraud`, `abuse`) on the check. Only verified businesses' reports about their own domain count.
- **Owners** see every report about their agents and can dispute it. The reporter has 30 days to confirm or it is removed.

## Layout

| Path | What |
|---|---|
| `apps/api` | Hono API on Node, Postgres (plain SQL via `postgres`). Signature verification uses Cloudflare's `web-bot-auth`. |
| `apps/web` | Next.js dashboard, public agent pages, docs. Proxies `/v1/*` to the API so the session cookie is first-party. |
| `packages/sdk` | `@standing/sdk` — `Standing` client + Express middleware for sites; `@standing/sdk/agent` for signing; `@standing/sdk/testing` for published test agents. |
| `packages/cli` | `standing agent create|list`, `standing request <url>` (signed), `standing lookup <id>`. |
| `examples/store` | A shop that checks agents with the SDK and reports outcomes. |
| `examples/agent` | A shopping agent that signs its requests. |
| `e2e` | Playwright test that drives the whole product. |

## Run it

Requires Node 22+, pnpm, and Postgres on `localhost:5432`.

```sh
pnpm install
createdb standing && createdb standing_test && createdb standing_e2e
STANDING_ALLOW_PRIVATE_NETWORK=1 pnpm dev   # API :4100, web :3100 (migrates on start)
```

Try the example shop and agent (in two terminals):

```sh
STANDING_API_KEY=sd_test_… pnpm --filter @standing/example-store start
STANDING_AGENT_KEY=./standing-agent-agt_….json pnpm --filter @standing/example-agent start http://localhost:5100 mug
```

## Test

```sh
pnpm test       # API integration tests against real Postgres + SDK tests
pnpm test:e2e   # builds everything, starts API/web/store on 4110/3110/5110, drives the UI, SDK, CLI
pnpm typecheck
```

The end-to-end run writes screenshots of every screen to `e2e/.artifacts/screens`.

## Design decisions

- **Verification happens on the server, not in the SDK.** A report must reference a check whose signature Standing verified, so reports are tied to real interactions and cannot be fabricated. It also lets Standing reject a signature replayed at a second business.
- **Only signed headers leave the site.** The SDK forwards `Signature`, `Signature-Input`, `Signature-Agent` and headers the signature covers, never cookies or authorization. Unsigned requests are never sent.
- **Registry first, then self-hosted directories.** A registered key identifies the agent and its owner. Otherwise the key is fetched from the `Signature-Agent` directory (HTTPS only, no private addresses, no redirects, 2 s, 64 KB) and standing is tracked under that directory URL.
- **Proof of possession on key registration**, so nobody can register someone else's public key and inherit its standing.
- **Reports count only when:** live key, verified reporter domain, request authority on that domain, reporter does not own the agent. Each reporter's contribution is log-scaled; negatives weigh more and decay slower; reporters whose disputed reports fail lose weight.
- **Agent, not person.** Public pages show aggregates only. Numeric scores are hidden unless a verified organization owns the agent. Retention: unreported checks 90 days, completed 1 year, negative 2 years.
- **Monitor mode by default, fail open.** Nothing is blocked until a site switches to enforce; if Standing is unreachable the SDK allows (or denies with `failClosed`).

## Not built yet

- Guarantees on allowed transactions (needs insurance review; see research notes).
- Visa TAP (`agent-browser-auth` / `agent-payer-auth` tags) and Skyfire KYAPay tokens; Web Bot Auth only for now.
- Signed key-directory responses for registered agents (Standing does not hold private keys, so it serves the JWKS unsigned).
- Email delivery (password reset, dispute notifications) and multi-user organizations.
- Rate limits are in-memory per instance.
