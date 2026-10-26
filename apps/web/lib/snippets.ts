import { API_PUBLIC_URL } from "./api";

const baseUrlLine = API_PUBLIC_URL === "https://api.standing.dev" ? "" : `\n  baseUrl: "${API_PUBLIC_URL}",`;

export const businessSnippet = (key = "sd_test_…") => `import { Standing } from "@standing/sdk";

const standing = new Standing({
  apiKey: "${key}",${baseUrlLine}
});

// In the handler for any action an agent can take:
const result = await standing.check(request, { action: "checkout" });
if (result?.blocked) return new Response("Not allowed", { status: 403 });

// Later, when you know how it went:
await standing.report(result.id, "completed"); // or "disputed", "fraud", "abuse"`;

export const agentSnippet = (file = "standing-agent.json") => `import { readFileSync } from "node:fs";
import { createAgentFetch } from "@standing/sdk/agent";

const agentFetch = createAgentFetch(readFileSync("${file}", "utf8"));

// Every request is signed with your agent's key.
await agentFetch("https://shop.example/checkout", { method: "POST", body });`;

export const cliSnippet = `npm install -g @standing/cli
export STANDING_API_KEY=sd_live_…${API_PUBLIC_URL === "https://api.standing.dev" ? "" : `\nexport STANDING_API_URL=${API_PUBLIC_URL}`}
standing agent create "My shopping agent"`;
