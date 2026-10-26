import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createAgentFetch, generateAgentKeyPair, signRequest, type AgentKey } from "../src/agent.ts";
import { isSignedRequest, signedHeaders, Standing } from "../src/index.ts";

const servers: ReturnType<typeof createServer>[] = [];
afterAll(() => servers.forEach((s) => s.close()));

async function server(handler: (body: any, req: import("node:http").IncomingMessage) => { status: number; body: unknown; delayMs?: number }) {
  const s = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const out = handler(raw ? JSON.parse(raw) : null, req);
    if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
    res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servers.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

async function newKey(): Promise<AgentKey> {
  const { privateKey } = await generateAgentKeyPair();
  return { agent_id: "agt_x", directory: "https://agt-x.agents.standing.dev", private_key: privateKey };
}

describe("agent signing", () => {
  it("produces a Web Bot Auth signature that verifies with the public key", async () => {
    const key = await newKey();
    const signed = await signRequest(new Request("https://shop.example/checkout", { method: "POST", body: "{}" }), key);
    expect(signed.headers.get("signature-agent")).toBe(`sig1="${key.directory}";type=directory`);
    expect(signed.headers.get("signature-input")).toMatch(/tag="web-bot-auth"/);
    expect(await signed.text()).toBe("{}");

    const verifier = await verifierFromJWK({ kty: "OKP", crv: "Ed25519", x: key.private_key.x });
    const result = await verify(signed, { resolver: () => verifier });
    expect(result.keyid).toBe(verifier.keyid);
  });

  it("wraps fetch so every request is signed", async () => {
    let seen: Record<string, unknown> = {};
    const url = await server((_, req) => {
      seen = req.headers;
      return { status: 200, body: { ok: true } };
    });
    const agentFetch = createAgentFetch(JSON.stringify(await newKey()));
    const res = await agentFetch(`${url}/products`);
    expect(res.status).toBe(200);
    expect(seen).toHaveProperty("signature");
    expect(seen).toHaveProperty("signature-input");
  });

  it("rejects things that are not agent keys", () => {
    expect(() => createAgentFetch("{}")).toThrow(/not an agent key/);
  });
});

describe("business client", () => {
  it("forwards only signed headers, never cookies", async () => {
    const signed = await signRequest(new Request("https://shop.example/", { headers: { cookie: "session=secret", "x-other": "1" } }), await newKey());
    const headers = signedHeaders(signed);
    expect(Object.keys(headers).sort()).toEqual(["signature", "signature-agent", "signature-input"]);
    expect(isSignedRequest(signed)).toBe(true);
    expect(isSignedRequest(new Request("https://shop.example/"))).toBe(false);
  });

  it("returns null for unsigned requests without calling Standing", async () => {
    const standing = new Standing({ apiKey: "sd_test_x", baseUrl: "http://127.0.0.1:1" });
    expect(await standing.check(new Request("https://shop.example/"))).toBeNull();
  });

  it("fails open when Standing is unreachable, or closed when configured", async () => {
    const signed = await signRequest(new Request("https://shop.example/"), await newKey());
    const open = await new Standing({ apiKey: "sd_test_x", baseUrl: "http://127.0.0.1:1" }).check(signed);
    expect(open).toMatchObject({ id: null, decision: "allow", blocked: false });
    const closed = await new Standing({ apiKey: "sd_test_x", baseUrl: "http://127.0.0.1:1", failClosed: true }).check(signed);
    expect(closed).toMatchObject({ decision: "deny", blocked: true });

    const slow = await server(() => ({ status: 200, body: {}, delayMs: 500 }));
    const timedOut = await new Standing({ apiKey: "sd_test_x", baseUrl: slow, timeoutMs: 50 }).check(signed);
    expect(timedOut?.error?.code).toBe("timeout");
  });

  it("blocks only when the decision is enforced, and the middleware answers for you", async () => {
    let decision = { decision: "deny", enforced: true };
    const api = await server((body) => ({ status: 201, body: { id: "chk_1", reasons: [{ code: "standing_poor", message: "Poor standing" }], ...decision, request: body } }));
    const standing = new Standing({ apiKey: "sd_live_x", baseUrl: api });
    const signed = await signRequest(new Request("https://shop.example/checkout"), await newKey());
    expect((await standing.check(signed))?.blocked).toBe(true);

    const middleware = standing.middleware({ action: "checkout" });
    const req = { method: "POST", originalUrl: "/checkout", protocol: "https", headers: Object.fromEntries(signed.headers) } as any;
    let status = 0;
    let sent: any = null;
    let nextCalled = false;
    await middleware(req, { status: (s) => ((status = s), { json: (b) => (sent = b) }) }, () => (nextCalled = true));
    expect(status).toBe(403);
    expect(sent.error.code).toBe("agent_deny");
    expect(nextCalled).toBe(false);

    decision = { decision: "deny", enforced: false };
    await middleware(req, { status: () => ({ json: () => {} }) }, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
    expect(req.standing).toMatchObject({ decision: "deny", blocked: false });
  });
});
