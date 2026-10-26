import { signedHeaders } from "@standing/sdk";
import { generateAgentKeyPair, proveKey, signRequest, type AgentKey } from "@standing/sdk/agent";
import { generateNonce, sign } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "../src/db.ts";
import { env } from "../src/env.ts";
import { runMaintenance } from "../src/maintenance.ts";
import { testAgentKey } from "@standing/sdk/testing";
import { agent, api, business, check, resetDatabase, startSite, stopSites } from "./helpers.ts";

beforeEach(resetDatabase);
afterAll(async () => {
  await stopSites();
  await sql.end();
});

describe("accounts", () => {
  it("signs up, reads the session, logs out, and logs back in", async () => {
    const signup = await api("/v1/auth/signup", { body: { name: "Acme", email: "Ops@Acme.test", password: "correct horse battery" } });
    expect(signup.status).toBe(201);
    expect(signup.body.account).toMatchObject({ name: "Acme", email: "ops@acme.test", domain_verified: false });
    const cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
    expect(signup.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    expect((await api("/v1/auth/me", { cookie })).body.account.name).toBe("Acme");
    expect((await api("/v1/auth/logout", { cookie, body: {} })).status).toBe(200);
    expect((await api("/v1/auth/me", { cookie })).status).toBe(401);

    expect((await api("/v1/auth/login", { body: { email: "ops@acme.test", password: "wrong password!" } })).status).toBe(401);
    expect((await api("/v1/auth/login", { body: { email: "ops@acme.test", password: "correct horse battery" } })).status).toBe(200);
    expect((await api("/v1/auth/signup", { body: { name: "Again", email: "ops@acme.test", password: "correct horse battery" } })).status).toBe(409);
  });

  it("rate-limits sign-ups and ignores spoofed X-Forwarded-For", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await api("/v1/auth/signup", {
        body: { name: "Spam", email: `spam${i}@example.com`, password: "correct horse battery" },
        headers: { "x-forwarded-for": `203.0.113.${i}` },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("rejects weak passwords and non-JSON session writes", async () => {
    const weak = await api("/v1/auth/signup", { body: { name: "A", email: "a@a.test", password: "short" } });
    expect(weak.status).toBe(400);
    expect(weak.body.error.message).toMatch(/10 characters/);

    const biz = await business("Formy", { verify: false });
    const form = await api("/v1/keys", { cookie: biz.cookie, body: "name=x&mode=live", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
  });

  it("verifies a domain from a well-known file and refuses a domain someone else verified", async () => {
    const biz = await business("Verified");
    expect((await api("/v1/auth/me", { cookie: biz.cookie })).body.account).toMatchObject({ domain: biz.host, domain_verified: true });

    const other = await business("Squatter", { verify: false });
    const taken = await api("/v1/account", { method: "PATCH", cookie: other.cookie, body: { domain: biz.host } });
    expect(taken.status).toBe(409);

    const noToken = await business("NoToken", { verify: false });
    await api("/v1/account", { method: "PATCH", cookie: noToken.cookie, body: { domain: "127.0.0.1:19" } });
    const failed = await api("/v1/account/verify-domain", { cookie: noToken.cookie, body: {} });
    expect(failed.status).toBe(422);
    expect(failed.body.error.message).toMatch(/standing-verification\.txt/);
  });

  it("shows API keys once, lists hints, and revokes", async () => {
    const biz = await business("Keys");
    const created = await api("/v1/keys", { cookie: biz.cookie, body: { name: "server", mode: "live" } });
    expect(created.body.key.secret).toMatch(/^sd_live_/);
    const list = await api("/v1/keys", { cookie: biz.cookie });
    expect(list.body.data.every((k: any) => !("secret" in k))).toBe(true);
    expect(list.body.data[0].hint).toMatch(/^sd_live_…/);

    await api(`/v1/keys/${created.body.key.id}`, { method: "DELETE", cookie: biz.cookie, body: {} });
    const denied = await api("/v1/checks", { key: created.body.key.secret, body: {} });
    expect(denied.status).toBe(401);
  });
});

describe("agents", () => {
  it("registers an agent only with proof of the private key", async () => {
    const owner = await business("Builder");
    const pair = await generateAgentKeyPair();
    const bad = await api("/v1/agents", { cookie: owner.cookie, body: { name: "x", public_key: pair.publicKey, proof: await proveKey("acc_someoneelse", pair.privateKey) } });
    expect(bad.status).toBe(422);

    const key = await agent(owner);
    expect(key.agent_id).toMatch(/^agt_/);
    expect(key.directory).toBe(`http://${key.agent_id.replace("_", "-")}.agents.test`);

    // The same public key cannot be claimed twice.
    const other = await business("Thief");
    const stolen = await api("/v1/agents", { cookie: other.cookie, body: { name: "y", public_key: pair.publicKey, proof: await proveKey(other.id, pair.privateKey) } });
    expect(stolen.status).toBe(201);
    const again = await api("/v1/agents", { cookie: other.cookie, body: { name: "z", public_key: pair.publicKey, proof: await proveKey(other.id, pair.privateKey) } });
    expect(again.status).toBe(409);
  });

  it("serves each agent's key directory on its own origin and by path", async () => {
    const owner = await business("Dir");
    const key = await agent(owner);
    const byHost = await api("/.well-known/http-message-signatures-directory", { headers: { host: `${key.agent_id.replace("_", "-")}.agents.test` } });
    expect(byHost.status).toBe(200);
    expect(byHost.headers.get("content-type")).toBe("application/http-message-signatures-directory+json");
    expect(byHost.body.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", x: key.private_key.x, alg: "EdDSA" });
    expect(byHost.body.keys[0].d).toBeUndefined();

    const byPath = await api(`/v1/agents/${key.agent_id}/jwks`);
    expect(byPath.body).toEqual(byHost.body);
  });

  it("rotates keys: new key signs, removed key is refused", async () => {
    const owner = await business("Rotator");
    const shop = await business("RotShop");
    const key = await agent(owner);
    const pair = await generateAgentKeyPair();
    const added = await api(`/v1/agents/${key.agent_id}/keys`, { cookie: owner.cookie, body: { public_key: pair.publicKey, proof: await proveKey(owner.id, pair.privateKey) } });
    expect(added.status).toBe(201);
    const oldKid = (await api(`/v1/agents/${key.agent_id}/keys`, { cookie: owner.cookie })).body.data[0].kid;
    await api(`/v1/agents/${key.agent_id}/keys/${oldKid}`, { method: "DELETE", cookie: owner.cookie, body: {} });

    const withNew = await check(shop.live, { ...key, private_key: pair.privateKey }, `${shop.origin}/buy`);
    expect(withNew.body.decision).toBe("allow");
    const withOld = await check(shop.live, key, `${shop.origin}/buy`);
    expect(withOld.body).toMatchObject({ decision: "deny", reasons: [{ code: "key_revoked" }] });
  });
});

describe("checks", () => {
  it("allows a signed agent with no history by default, in monitor mode", async () => {
    const owner = await business("Maker");
    const shop = await business("Shop");
    const key = await agent(owner);
    const res = await check(shop.live, key, `${shop.origin}/checkout`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      decision: "allow",
      enforced: false,
      mode: "live",
      counts: true,
      agent: { id: key.agent_id, registered: true, owner: { name: "Maker", verified: true } },
      standing: { level: "unknown" },
      signature: { valid: true },
      request: { method: "POST", authority: shop.host, path: "/checkout", action: "checkout" },
    });
    expect(res.body.reasons.map((r: any) => r.code)).toEqual(["signature_valid", "owner_verified", "standing_unknown"]);
  });

  it("returns the same check when one business retries, and denies a signature replayed elsewhere", async () => {
    const owner = await business("Replay");
    const shop = await business("ShopA");
    const other = await business("ShopB");
    const key = await agent(owner);
    const signed = await signRequest(new Request(`${shop.origin}/checkout`, { method: "POST" }), key);

    const first = await check(shop.live, signed);
    const retry = await check(shop.live, signed);
    expect(retry.body.id).toBe(first.body.id);

    const replayed = await check(other.live, signed);
    expect(replayed.body).toMatchObject({ decision: "deny", reasons: [{ code: "signature_replayed" }] });
  });

  it("denies tampered and expired signatures", async () => {
    const owner = await business("Tamper");
    const shop = await business("TShop");
    const key = await agent(owner);
    const signed = await signRequest(new Request(`${shop.origin}/checkout`, { method: "POST" }), key);

    // Same signature presented for a different site.
    const moved = await api("/v1/checks", { key: shop.live, body: { method: "POST", url: "http://127.0.0.1:1/checkout", headers: signedHeaders(signed) } });
    expect(moved.body).toMatchObject({ decision: "deny", reasons: [{ code: "signature_invalid" }] });

    const request = new Request(`${shop.origin}/checkout`, { headers: { "signature-agent": `sig1="${key.directory}"` } });
    const past = new Date(Date.now() - 10 * 60_000);
    const fields = await sign(request, { signer: await signerFromJWK(key.private_key), created: past, expires: new Date(past.getTime() + 60_000), nonce: generateNonce() });
    const expired = await api("/v1/checks", {
      key: shop.live,
      body: { method: "GET", url: request.url, headers: { "signature-agent": `sig1="${key.directory}"`, signature: fields.signature, "signature-input": fields.signatureInput } },
    });
    expect(expired.body.decision).toBe("deny");
    expect(expired.body.reasons[0].code).toMatch(/signature_(expired|stale)/);
  });

  it("refuses unsigned requests and challenges keys it cannot resolve", async () => {
    const shop = await business("Unsigned");
    const unsigned = await api("/v1/checks", { key: shop.live, body: { method: "GET", url: `${shop.origin}/`, headers: {} } });
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.error.code).toBe("not_signed");

    const pair = await generateAgentKeyPair();
    const stranger: AgentKey = { agent_id: "agt_nobody", directory: "http://agt-nobody.agents.test", private_key: pair.privateKey };
    const res = await check(shop.live, stranger, `${shop.origin}/checkout`);
    expect(res.body).toMatchObject({ decision: "challenge", agent: null, signature: { valid: false }, reasons: [{ code: "unknown_key" }] });

    const report = await api(`/v1/checks/${res.body.id}/outcome`, { key: shop.live, body: { outcome: "fraud" } });
    expect(report.status).toBe(409);
  });

  it("verifies agents that host their own Web Bot Auth key directory", async () => {
    const shop = await business("Selfhost");
    const pair = await generateAgentKeyPair();
    const site = await startSite({
      "/.well-known/http-message-signatures-directory": { type: "application/http-message-signatures-directory+json", body: JSON.stringify({ keys: [pair.publicKey] }) },
    });
    const selfHosted: AgentKey = { agent_id: "self", directory: site.origin, private_key: pair.privateKey };
    const res = await check(shop.live, selfHosted, `${shop.origin}/checkout`);
    expect(res.body).toMatchObject({ decision: "allow", agent: { registered: false, directory: site.origin, name: site.host, owner: null } });
    expect(res.body.reasons[1].code).toBe("self_hosted");

    // Same directory, same agent record.
    const again = await check(shop.live, selfHosted, `${shop.origin}/checkout`);
    expect(again.body.agent.id).toBe(res.body.agent.id);
  });

  it("will not fetch key directories on private addresses in production mode", async () => {
    const shop = await business("Ssrf");
    const pair = await generateAgentKeyPair();
    const site = await startSite({ "/.well-known/http-message-signatures-directory": { type: "application/json", body: JSON.stringify({ keys: [pair.publicKey] }) } });
    env.allowPrivateNetwork = false;
    try {
      const res = await check(shop.live, { agent_id: "x", directory: site.origin.replace("http:", "https:"), private_key: pair.privateKey }, `${shop.origin}/checkout`);
      expect(res.body).toMatchObject({ decision: "challenge", reasons: [{ code: "directory_unavailable" }] });
      expect(res.body.reasons[0].message).toMatch(/private address/);
    } finally {
      env.allowPrivateNetwork = true;
    }
  });

  it("uses published test agents with test keys and denies them with live keys", async () => {
    const shop = await business("Tester");
    const [good, poor] = [testAgentKey("good", "agents.test"), testAgentKey("poor", "agents.test")];
    const testGood = await check(shop.test, good, `${shop.origin}/checkout`);
    expect(testGood.body).toMatchObject({ decision: "allow", mode: "test", counts: false, standing: { level: "good", score: 94 } });
    const testPoor = await check(shop.test, poor, `${shop.origin}/checkout`);
    expect(testPoor.body).toMatchObject({ decision: "challenge", standing: { level: "poor" } });
    const live = await check(shop.live, good, `${shop.origin}/checkout`);
    expect(live.body).toMatchObject({ decision: "deny", reasons: [{ code: "signature_valid" }, { code: "test_agent" }] });
  });

  it("applies the business's policy and enforces it when asked", async () => {
    const shop = await business("Strict");
    const poor = testAgentKey("poor", "agents.test");
    const fresh = testAgentKey("new", "agents.test");
    const policy = await api("/v1/account/policy", { method: "PUT", cookie: shop.cookie, body: { mode: "enforce", unknown_action: "challenge", poor_action: "deny" } });
    expect(policy.body.policy).toEqual({ mode: "enforce", unknown_action: "challenge", poor_action: "deny" });
    expect((await check(shop.test, poor, `${shop.origin}/x`)).body).toMatchObject({ decision: "deny", enforced: true });
    expect((await check(shop.test, fresh, `${shop.origin}/x`)).body).toMatchObject({ decision: "challenge", enforced: true });
  });

  it("denies revoked agents", async () => {
    const owner = await business("Revoker");
    const shop = await business("RShop");
    const key = await agent(owner);
    await api(`/v1/agents/${key.agent_id}/revoke`, { cookie: owner.cookie, body: {} });
    expect((await check(shop.live, key, `${shop.origin}/checkout`)).body).toMatchObject({ decision: "deny", reasons: [{}, { code: "agent_revoked" }] });
    expect((await api(`/v1/agents/${key.agent_id}`)).body.agent.revoked).toBe(true);
  });

  it("lists checks by mode and decision with pagination", async () => {
    const shop = await business("Lister");
    const good = testAgentKey("good", "agents.test");
    for (let i = 0; i < 3; i++) await check(shop.test, good, `${shop.origin}/p${i}`);
    await check(shop.live, good, `${shop.origin}/live`);
    const page = await api("/v1/checks?mode=test&limit=2", { cookie: shop.cookie });
    expect(page.body.data).toHaveLength(2);
    expect(page.body.has_more).toBe(true);
    const next = await api(`/v1/checks?mode=test&limit=2&before=${page.body.data[1].id}`, { cookie: shop.cookie });
    expect(next.body.data).toHaveLength(1);
    expect((await api("/v1/checks?decision=deny", { cookie: shop.cookie })).body.data).toHaveLength(1);
    expect((await api("/v1/checks", { key: shop.test })).body.data).toHaveLength(3);
  });
});

describe("outcomes and standing", () => {
  async function reportFrom(shopName: string, key: AgentKey, outcome: string) {
    const shop = await business(shopName);
    const res = await check(shop.live, key, `${shop.origin}/checkout`);
    const reported = await api(`/v1/checks/${res.body.id}/outcome`, { key: shop.live, body: { outcome, reference: `order_${shopName}` } });
    expect(reported.status).toBe(200);
    return { shop, check: res.body, reported: reported.body };
  }

  it("builds standing from several businesses and shows it publicly as aggregates", async () => {
    const owner = await business("Goodbot");
    const key = await agent(owner);
    for (const name of ["S1", "S2", "S3", "S4"]) {
      const { shop, check: c } = await reportFrom(name, key, "completed");
      const again = await check(shop.live, key, `${shop.origin}/checkout`);
      await api(`/v1/checks/${again.body.id}/outcome`, { key: shop.live, body: { outcome: "completed" } });
      expect(c.counts).toBe(true);
    }
    const pub = await api(`/v1/agents/${key.agent_id}`);
    expect(pub.body.agent.standing).toMatchObject({ level: "good", reports: 8, reporters: 4, negative: 0 });
    expect(pub.body.agent.standing.score).toBeGreaterThanOrEqual(80);
    expect(JSON.stringify(pub.body)).not.toMatch(/S1|order_/);
  });

  it("hides the numeric score when the owner is not a verified organization", async () => {
    const owner = await business("Anon", { verify: false });
    const key = await agent(owner);
    for (const name of ["H1", "H2", "H3"]) await reportFrom(name, key, "completed");
    const pub = await api(`/v1/agents/${key.agent_id}`);
    expect(pub.body.agent.owner).toEqual({ name: "Anon", domain: null, verified: false });
    expect(pub.body.agent.standing).toMatchObject({ level: "neutral", score: null, reporters: 3 });
  });

  it("only counts reports from verified businesses about their own domain, never self-reports or test checks", async () => {
    const owner = await business("Owner");
    const key = await agent(owner);

    const self = await check(owner.live, key, `${owner.origin}/checkout`);
    expect(self.body.counts).toBe(false);

    const unverified = await business("Unverified", { verify: false });
    expect((await check(unverified.live, key, `${unverified.origin}/checkout`)).body.counts).toBe(false);

    const shop = await business("OtherDomain");
    expect((await check(shop.live, key, "http://127.0.0.1:1/checkout")).body.signature.valid).toBe(true);
    expect((await check(shop.live, key, "http://127.0.0.1:1/checkout")).body.counts).toBe(false);
    expect((await check(shop.test, key, `${shop.origin}/checkout`)).body.counts).toBe(false);

    for (const c of [self.body.id]) await api(`/v1/checks/${c}/outcome`, { key: owner.live, body: { outcome: "completed" } });
    expect((await api(`/v1/agents/${key.agent_id}`)).body.agent.standing.reports).toBe(0);
  });

  it("lets outcomes change until disputed, and runs the dispute process", async () => {
    const owner = await business("Disputed");
    const key = await agent(owner);
    const a = await reportFrom("FraudA", key, "completed");
    const b = await reportFrom("FraudB", key, "fraud");

    // A chargeback arrives later: the business updates its report.
    const updated = await api(`/v1/checks/${a.check.id}/outcome`, { key: a.shop.live, body: { outcome: "fraud" } });
    expect(updated.body.outcome.outcome).toBe("fraud");
    expect(updated.body.standing.negative).toBe(2);

    const reports = await api(`/v1/agents/${key.agent_id}/reports`, { cookie: owner.cookie });
    expect(reports.body.data).toHaveLength(2);
    expect(reports.body.data.every((r: any) => r.can_dispute)).toBe(true);
    expect(reports.body.data.map((r: any) => r.site).sort()).toEqual([a.shop.host, b.shop.host].sort());

    // Only the owner can dispute; only negative reports; only once.
    expect((await api(`/v1/reports/${a.check.id}/dispute`, { cookie: b.shop.cookie, body: { note: "no" } })).status).toBe(404);
    expect((await api(`/v1/reports/${a.check.id}/dispute`, { cookie: owner.cookie, body: { note: "Customer confirmed this order." } })).status).toBe(200);
    expect((await api(`/v1/reports/${a.check.id}/dispute`, { cookie: owner.cookie, body: { note: "again" } })).status).toBe(409);
    expect((await api(`/v1/reports/${b.check.id}/dispute`, { cookie: owner.cookie, body: { note: "Refunded in full." } })).status).toBe(200);

    // While disputed, the reporter cannot silently change the report.
    expect((await api(`/v1/checks/${a.check.id}/outcome`, { key: a.shop.live, body: { outcome: "abuse" } })).status).toBe(409);

    const toResolve = await api("/v1/reports/disputed", { cookie: a.shop.cookie });
    expect(toResolve.body.data).toHaveLength(1);
    expect(toResolve.body.data[0]).toMatchObject({ check_id: a.check.id, dispute_note: "Customer confirmed this order." });

    expect((await api(`/v1/reports/${a.check.id}/resolve`, { cookie: a.shop.cookie, body: { resolution: "withdraw" } })).body.status).toBe("removed");
    expect((await api(`/v1/reports/${b.check.id}/resolve`, { cookie: b.shop.cookie, body: { resolution: "confirm" } })).body.status).toBe("confirmed");

    const standing = (await api(`/v1/agents/${key.agent_id}`)).body.agent.standing;
    expect(standing).toMatchObject({ reports: 1, negative: 1, under_dispute: 0 });
  });

  it("removes a disputed report the business never answers", async () => {
    const owner = await business("Patient");
    const key = await agent(owner);
    const { check: c } = await reportFrom("Silent", key, "abuse");
    await api(`/v1/reports/${c.id}/dispute`, { cookie: owner.cookie, body: { note: "Never happened." } });
    await sql`update outcomes set disputed_at = now() - interval '31 days' where check_id = ${c.id}`;
    expect((await api(`/v1/agents/${key.agent_id}`)).body.agent.standing.reports).toBe(0);
    await runMaintenance();
    const [row] = await sql`select status from outcomes where check_id = ${c.id}`;
    expect(row!.status).toBe("removed");
  });

  it("drops old records under the retention rules", async () => {
    const owner = await business("Old");
    const key = await agent(owner);
    const { check: kept } = await reportFrom("Keep", key, "fraud");
    const shop = await business("Forget");
    const unreported = await check(shop.live, key, `${shop.origin}/checkout`);
    await sql`update checks set created_at = now() - interval '91 days' where id = ${unreported.body.id}`;
    await runMaintenance();
    expect(await sql`select id from checks where id = ${unreported.body.id}`).toHaveLength(0);
    expect(await sql`select id from checks where id = ${kept.id}`).toHaveLength(1);
  });
});

describe("overview", () => {
  it("summarises what needs attention", async () => {
    const owner = await business("Summary");
    const key = await agent(owner);
    const shop = await business("SumShop");
    const res = await check(shop.live, key, `${shop.origin}/checkout`);
    await api(`/v1/checks/${res.body.id}/outcome`, { key: shop.live, body: { outcome: "fraud" } });
    expect((await api("/v1/overview", { cookie: owner.cookie })).body).toMatchObject({ agents: 1, reports_to_review: 1, keys: 2 });
    expect((await api("/v1/overview", { cookie: shop.cookie })).body).toMatchObject({ live_checks: 1, disputes_to_resolve: 0 });
  });
});
