import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { signedHeaders } from "@standing/sdk";
import { generateAgentKeyPair, proveKey, signRequest, type AgentKey } from "@standing/sdk/agent";
import { createApp } from "../src/app.ts";
import { sql } from "../src/db.ts";
import { resetRateLimits } from "../src/http.ts";
import { migrate } from "../src/migrate.ts";
import { seedTestAgents } from "../src/test-agents.ts";
import { clearDirectoryCache } from "../src/directory.ts";

export const app = createApp();

type Options = { method?: string; body?: unknown; cookie?: string; key?: string; headers?: Record<string, string> };

export async function api<T = any>(path: string, options: Options = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["content-type"] ??= "application/json";
  if (options.cookie) headers.cookie = options.cookie;
  if (options.key) headers.authorization = `Bearer ${options.key}`;
  const response = await app.request(path, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

const servers: Server[] = [];

/** A tiny local site. `routes` maps paths to responses. */
export async function startSite(routes: Record<string, { type: string; body: string }>): Promise<{ origin: string; host: string }> {
  const server = createServer((req, res) => {
    const route = routes[req.url ?? ""];
    if (!route) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": route.type }).end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` };
}

export async function stopSites() {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
}

export async function resetDatabase() {
  await migrate();
  await sql`truncate accounts, sessions, api_keys, agents, agent_keys, checks, outcomes, replays, policies cascade`;
  await seedTestAgents();
  resetRateLimits();
  clearDirectoryCache();
}

let counter = 0;

export type Business = { id: string; cookie: string; live: string; test: string; host: string; origin: string };

/** An account with a session, test and live keys, and optionally a verified domain. */
export async function business(name: string, { verify = true } = {}): Promise<Business> {
  counter++;
  const signup = await api("/v1/auth/signup", { body: { name, email: `${name.toLowerCase().replace(/\W/g, "")}${counter}@example.com`, password: "correct horse battery" } });
  if (signup.status !== 201) throw new Error(`signup failed: ${JSON.stringify(signup.body)}`);
  const cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
  const account = signup.body.account;

  const site = await startSite({ "/.well-known/standing-verification.txt": { type: "text/plain", body: account.domain_token } });
  if (verify) {
    await api("/v1/account", { method: "PATCH", cookie, body: { domain: site.host } });
    const verified = await api("/v1/account/verify-domain", { cookie, body: {} });
    if (verified.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
  }
  const live = (await api("/v1/keys", { cookie, body: { name: "live", mode: "live" } })).body.key.secret;
  const test = (await api("/v1/keys", { cookie, body: { name: "test", mode: "test" } })).body.key.secret;
  return { id: account.id, cookie, live, test, ...site };
}

/** Registers an agent under the given account and returns its key file. */
export async function agent(owner: Business, name = "Shopper"): Promise<AgentKey> {
  const pair = await generateAgentKeyPair();
  const res = await api("/v1/agents", { cookie: owner.cookie, body: { name, public_key: pair.publicKey, proof: await proveKey(owner.id, pair.privateKey) } });
  if (res.status !== 201) throw new Error(`agent create failed: ${JSON.stringify(res.body)}`);
  return { agent_id: res.body.agent.id, directory: res.body.agent.directory, private_key: pair.privateKey };
}

/** Signs a request as `key` to `url` and asks Standing about it with `apiKey`. */
export async function check(apiKey: string, key: AgentKey | Request, url?: string, action = "checkout") {
  const request = key instanceof Request ? key : await signRequest(new Request(url!, { method: "POST" }), key);
  return api("/v1/checks", { key: apiKey, body: { method: request.method, url: request.url, headers: signedHeaders(request), action } });
}
