// A small shop that checks AI agents with Standing before taking their orders.
import { serve } from "@hono/node-server";
import { Standing } from "@standing/sdk";
import { Hono } from "hono";

const port = Number(process.env.PORT ?? 5100);
const config = {
  apiKey: process.env.STANDING_API_KEY ?? "",
  apiUrl: process.env.STANDING_API_URL ?? "http://localhost:4100",
  // Domain verification tokens by host, so one demo process can stand in for several sites.
  verification: {} as Record<string, string>,
};

const products = [
  { id: "mug", name: "Mug", price: 1800 },
  { id: "tee", name: "T-shirt", price: 3200 },
];
const orders = new Map<string, { id: string; product: string; checkId: string | null; status: string }>();

const standing = () => new Standing({ apiKey: config.apiKey, baseUrl: config.apiUrl });
const app = new Hono();

app.get("/.well-known/standing-verification.txt", (c) => c.text(config.verification[c.req.header("host") ?? ""] ?? process.env.STANDING_VERIFICATION_TOKEN ?? ""));
app.get("/products", (c) => c.json({ products }));

app.post("/checkout", async (c) => {
  const result = config.apiKey ? await standing().check(c.req.raw, { action: "checkout" }) : null;
  if (result?.blocked) {
    const message = result.error ? result.error.message : result.reasons.at(-1)?.message;
    return c.json({ error: result.decision === "challenge" ? "Please confirm this order in your account." : "Order refused.", reason: message }, result.decision === "challenge" ? 401 : 403);
  }
  const { product } = await c.req.json<{ product: string }>();
  if (!products.some((p) => p.id === product)) return c.json({ error: "Unknown product" }, 404);
  const order = { id: `ord_${orders.size + 1}`, product, checkId: result?.id ?? null, status: "placed" };
  orders.set(order.id, order);
  return c.json({ order, standing: result && !result.error ? { decision: result.decision, level: result.standing?.level ?? null } : null }, 201);
});

// Later events in an order's life are reported back so other shops learn from them.
async function settle(orderId: string, status: string, outcome: "completed" | "fraud") {
  const order = orders.get(orderId);
  if (!order) return null;
  order.status = status;
  if (order.checkId) await standing().report(order.checkId, outcome, { reference: order.id });
  return order;
}

app.post("/orders/:id/deliver", async (c) => {
  const order = await settle(c.req.param("id"), "delivered", "completed");
  return order ? c.json({ order }) : c.json({ error: "Not found" }, 404);
});

app.post("/orders/:id/chargeback", async (c) => {
  const order = await settle(c.req.param("id"), "charged back", "fraud");
  return order ? c.json({ order }) : c.json({ error: "Not found" }, 404);
});

// Demo only: lets the end-to-end test configure the running shop.
app.post("/admin/config", async (c) => {
  const { verification, ...rest } = await c.req.json<Partial<typeof config>>();
  Object.assign(config, rest);
  Object.assign(config.verification, verification);
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port }, () => console.log(`Example store on http://localhost:${port}`));
