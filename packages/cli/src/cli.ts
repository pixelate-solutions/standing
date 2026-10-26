#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createAgentFetch, generateAgentKeyPair, proveKey, type AgentKey } from "@standing/sdk/agent";

const HELP = `standing — register AI agents and send signed requests

Usage
  standing agent create <name> [--out <file>]   Register a new agent and save its key file
  standing agent list                           List your agents
  standing request <url> [options]              Send a request signed as your agent
  standing lookup <agent_id>                    Show an agent's public standing

Request options
  -X, --method <method>    HTTP method (default GET, or POST with --data)
  -d, --data <body>        Request body
  -H, --header <k: v>      Extra header (repeatable)
  -k, --key <file>         Agent key file (default $STANDING_AGENT_KEY)

Environment
  STANDING_API_KEY    API key from the dashboard (needed for agent commands)
  STANDING_API_URL    Default https://api.standing.dev
  STANDING_AGENT_KEY  Path to an agent key file, or its JSON
`;

const apiUrl = (process.env.STANDING_API_URL ?? "https://api.standing.dev").replace(/\/$/, "");

class CliError extends Error {}

async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.auth !== false) {
    const key = process.env.STANDING_API_KEY;
    if (!key) throw new CliError("Set STANDING_API_KEY to an API key from the dashboard.");
    headers.authorization = `Bearer ${key}`;
  }
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${apiUrl}${path}`, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined });
  const json = (await response.json().catch(() => null)) as { error?: { message: string } } | null;
  if (!response.ok) throw new CliError(json?.error?.message ?? `Standing returned ${response.status}`);
  return json as T;
}

function loadAgentKey(option?: string): AgentKey {
  const source = option ?? process.env.STANDING_AGENT_KEY;
  if (!source) throw new CliError("Pass --key <file> or set STANDING_AGENT_KEY.");
  const text = source.trim().startsWith("{") ? source : existsSync(source) ? readFileSync(source, "utf8") : null;
  if (!text) throw new CliError(`Key file not found: ${source}`);
  return JSON.parse(text) as AgentKey;
}

type Agent = { id: string; name: string; directory: string; revoked: boolean; standing: { level: string; score: number | null; reports: number; reporters: number } };

function describeStanding(s: Agent["standing"]) {
  const score = s.score === null ? "" : ` (${s.score}/100)`;
  return `${s.level}${score}, ${s.reports} reports from ${s.reporters} businesses`;
}

async function agentCreate(name: string | undefined, out: string | undefined) {
  if (!name) throw new CliError("Usage: standing agent create <name>");
  const { account } = await api<{ account: { id: string } }>("/v1/auth/me");
  const pair = await generateAgentKeyPair();
  const { agent } = await api<{ agent: Agent }>("/v1/agents", {
    body: { name, public_key: pair.publicKey, proof: await proveKey(account.id, pair.privateKey) },
  });
  const file = out ?? `standing-agent-${agent.id}.json`;
  const key: AgentKey = { agent_id: agent.id, directory: agent.directory, private_key: pair.privateKey };
  writeFileSync(file, JSON.stringify(key, null, 2) + "\n", { mode: 0o600 });
  console.log(`Created ${agent.name} (${agent.id})`);
  console.log(`Key saved to ${file}. Keep it secret; Standing does not have a copy.`);
  console.log(`\nSign requests with it:\n  STANDING_AGENT_KEY=${file} standing request https://example.com`);
}

async function agentList() {
  const { data } = await api<{ data: Agent[] }>("/v1/agents");
  if (data.length === 0) return console.log("No agents yet. Create one with: standing agent create <name>");
  for (const a of data) console.log(`${a.id}  ${a.name}${a.revoked ? " (revoked)" : ""}  —  ${describeStanding(a.standing)}`);
}

async function lookup(id: string | undefined) {
  if (!id) throw new CliError("Usage: standing lookup <agent_id>");
  const { agent } = await api<{ agent: Agent & { owner: { name: string; domain: string | null; verified: boolean } | null } }>(`/v1/agents/${encodeURIComponent(id)}`, { auth: false });
  const owner = agent.owner ? `${agent.owner.name}${agent.owner.verified ? ` (${agent.owner.domain}, verified)` : " (unverified)"}` : "not registered";
  console.log(`${agent.name} (${agent.id})\nOwner: ${owner}\nStanding: ${describeStanding(agent.standing)}${agent.revoked ? "\nRevoked" : ""}`);
}

async function request(url: string | undefined, values: { method?: string; data?: string; header?: string[]; key?: string }) {
  if (!url) throw new CliError("Usage: standing request <url>");
  const headers = new Headers();
  for (const h of values.header ?? []) {
    const i = h.indexOf(":");
    if (i < 1) throw new CliError(`Bad header: ${h}`);
    headers.set(h.slice(0, i).trim(), h.slice(i + 1).trim());
  }
  if (values.data && !headers.has("content-type")) headers.set("content-type", "application/json");
  const agentFetch = createAgentFetch(loadAgentKey(values.key));
  const response = await agentFetch(url, { method: values.method ?? (values.data ? "POST" : "GET"), headers, body: values.data });
  console.log(`${response.status} ${response.statusText}`);
  const text = await response.text();
  if (text) console.log(text);
  if (!response.ok) process.exitCode = 1;
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      method: { type: "string", short: "X" },
      data: { type: "string", short: "d" },
      header: { type: "string", short: "H", multiple: true },
      key: { type: "string", short: "k" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, sub, arg] = positionals;
  if (values.help || !command) return console.log(HELP);
  if (command === "agent" && sub === "create") return agentCreate(arg, values.out);
  if (command === "agent" && sub === "list") return agentList();
  if (command === "request") return request(sub, values);
  if (command === "lookup") return lookup(sub);
  throw new CliError(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof CliError ? error.message : error);
  process.exitCode = 1;
});
