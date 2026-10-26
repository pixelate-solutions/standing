export const env = {
  port: Number(process.env.PORT ?? 4100),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost:5432/standing",
  // Public origin of this API, used in docs and key directory URLs.
  publicUrl: process.env.STANDING_PUBLIC_URL ?? "http://localhost:4100",
  // Host under which each registered agent gets its own key directory origin,
  // e.g. agt-abc123.agents.standing.dev
  agentsHost: process.env.STANDING_AGENTS_HOST ?? "agents.localhost:4100",
  production: process.env.NODE_ENV === "production",
  // Set when the API runs behind a load balancer that appends X-Forwarded-For.
  trustProxy: process.env.STANDING_TRUST_PROXY === "1",
  // Local development only: allow http:// and private addresses for key
  // directories and domain verification.
  allowPrivateNetwork: process.env.STANDING_ALLOW_PRIVATE_NETWORK === "1",
};
