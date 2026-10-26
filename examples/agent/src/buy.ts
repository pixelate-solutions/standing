// An AI shopping agent that signs its requests so shops can recognise it.
// Usage: STANDING_AGENT_KEY=./standing-agent-xxx.json tsx src/buy.ts http://localhost:5100 mug
import { readFileSync } from "node:fs";
import { createAgentFetch } from "@standing/sdk/agent";

const [store = "http://localhost:5100", product = "mug"] = process.argv.slice(2);
const keySource = process.env.STANDING_AGENT_KEY;
if (!keySource) throw new Error("Set STANDING_AGENT_KEY to your agent key file.");

const agentFetch = createAgentFetch(readFileSync(keySource, "utf8"));

const { products } = (await (await agentFetch(`${store}/products`)).json()) as { products: { id: string; name: string }[] };
console.log(`Found ${products.length} products`);

const response = await agentFetch(`${store}/checkout`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ product }),
});
const result = await response.json();
console.log(JSON.stringify({ status: response.status, ...result }));
