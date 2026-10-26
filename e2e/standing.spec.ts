import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { testAgentKey } from "../packages/sdk/dist/testing.js";
import { E2E } from "../playwright.config";

const exec = promisify(execFile);
const ARTIFACTS = "e2e/.artifacts";
let shotCount = 0;

async function shot(page: Page, name: string) {
  shotCount++;
  await page.screenshot({ path: `${ARTIFACTS}/screens/${String(shotCount).padStart(2, "0")}-${name}.png`, fullPage: true });
}

async function run(command: string, args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout } = await exec(command, args, { env: { ...process.env, ...env }, timeout: 30_000 });
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const tsx = "node_modules/.bin/tsx";
const cli = (args: string[], env: Record<string, string> = {}) => run("node", ["packages/cli/dist/cli.js", ...args], { STANDING_API_URL: E2E.api, ...env });

async function buy(keyFile: string, product = "mug") {
  const { stdout } = await run(tsx, ["examples/agent/src/buy.ts", E2E.store, product], { STANDING_AGENT_KEY: keyFile });
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

async function store(path: string, body: unknown = {}) {
  const response = await fetch(`${E2E.store}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Organization name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function verifyDomain(page: Page, host: string) {
  await page.goto("/dashboard/settings");
  const card = page.locator("section", { has: page.locator("#domain") });
  await card.getByLabel("Domain", { exact: true }).fill(host);
  await card.getByRole("button", { name: "Save" }).click();
  const token = (await card.locator("pre").first().innerText()).trim();
  expect(token).toMatch(/^standing_/);
  await store("/admin/config", { verification: { [host]: token } });
  await card.getByRole("button", { name: "Verify domain" }).click();
  await expect(card.getByText(`${host} is verified.`)).toBeVisible();
}

async function createKey(page: Page, name: string, mode: "Test" | "Live") {
  await page.goto("/dashboard/keys");
  await page.getByRole("button", { name: "Create key" }).click();
  const dialog = page.getByRole("dialog", { name: "Create API key" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("radio", { name: mode }).click();
  await dialog.getByRole("button", { name: "Create key" }).click();
  const created = page.getByRole("dialog", { name: "Key created" });
  const secret = (await created.locator("pre").first().innerText()).trim();
  expect(secret).toMatch(new RegExp(`^sd_${mode.toLowerCase()}_`));
  await created.getByRole("button", { name: "Done" }).click();
  return secret;
}

test("the whole product, end to end", async ({ browser }) => {
  const business = await (await browser.newContext({ baseURL: E2E.web })).newPage();
  const builder = await (await browser.newContext({ baseURL: E2E.web, acceptDownloads: true })).newPage();
  const businessHost = "localhost:5110";
  const builderHost = "127.0.0.1:5110";
  let agentKeyFile = `${ARTIFACTS}/acme-shopper.json`;
  let agentId = "";
  let liveKey = "";
  let testKey = "";

  await test.step("public pages: home, lookup of a test agent, docs", async () => {
    await business.goto("/");
    await expect(business.getByRole("heading", { name: "Look up an AI agent" })).toBeVisible();
    await shot(business, "home");
    await business.getByLabel("Agent ID").fill("agt_testgood");
    await business.getByRole("button", { name: "Look up" }).click();
    await expect(business.getByRole("heading", { name: "Test agent (good standing)" })).toBeVisible();
    await expect(business.getByLabel("Standing").getByText("Good")).toBeVisible();
    await shot(business, "public-test-agent");

    await business.goto("/agents/agt_doesnotexist");
    await expect(business.getByRole("heading", { name: "No agent with that ID" })).toBeVisible();

    await business.goto("/docs");
    await expect(business.getByRole("heading", { name: "How standing works" })).toBeVisible();
    await expect(business.getByText("agt_testpoor").first()).toBeVisible();
    await shot(business, "docs");
  });

  await test.step("dashboard requires sign-in", async () => {
    await business.goto("/dashboard");
    await expect(business).toHaveURL(/\/login$/);
    await expect(business.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  await test.step("business signs up, verifies its domain, creates keys", async () => {
    await signUp(business, "Northwind Shop", "ops@northwind.test");
    await shot(business, "overview-empty");
    await verifyDomain(business, businessHost);
    await shot(business, "settings-verified");
    liveKey = await createKey(business, "Store server", "Live");
    testKey = await createKey(business, "Local testing", "Test");
    await expect(business.getByRole("row")).toHaveCount(3);
    await shot(business, "keys");
    await store("/admin/config", { apiKey: liveKey });
  });

  await test.step("builder signs up, verifies its domain, registers an agent in the browser", async () => {
    await signUp(builder, "Acme Agents", "dev@acme.test");
    await verifyDomain(builder, builderHost);
    await builder.goto("/dashboard/agents");
    await expect(builder.getByText("No agents yet")).toBeVisible();
    await builder.getByRole("button", { name: "Register agent" }).click();
    const dialog = builder.getByRole("dialog", { name: "Register agent" });
    await dialog.getByLabel("Name").fill("Acme Shopper");
    await dialog.getByRole("button", { name: "Create agent" }).click();
    const created = builder.getByRole("dialog", { name: "Agent registered" });
    await expect(created.getByText("Save this key file now")).toBeVisible();
    await shot(builder, "agent-key-file");
    const downloading = builder.waitForEvent("download");
    await created.getByRole("button", { name: "Download key file" }).click();
    await (await downloading).saveAs(agentKeyFile);
    await created.getByRole("button", { name: "I saved it" }).click();

    const key = JSON.parse(readFileSync(agentKeyFile, "utf8"));
    agentId = key.agent_id;
    expect(agentId).toMatch(/^agt_[a-z0-9]{20}$/);
    expect(key.directory).toBe(`http://${agentId.replace("_", "-")}.${E2E.agentsHost}`);
    expect(key.private_key).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    expect(key.private_key.d).toBeTruthy();
    await expect(builder.getByRole("link", { name: "Acme Shopper" })).toBeVisible();
    await shot(builder, "agents");

    // The public key directory is served and the private key is not in it.
    const directory = await (await fetch(`${E2E.api}/v1/agents/${agentId}/jwks`)).json();
    expect(directory.keys).toHaveLength(1);
    expect(directory.keys[0].x).toBe(key.private_key.x);
    expect(directory.keys[0].d).toBeUndefined();
  });

  await test.step("the agent shops; the store checks it with the SDK and reports outcomes", async () => {
    const first = await buy(agentKeyFile);
    expect(first).toMatchObject({ status: 201, order: { id: "ord_1" }, standing: { decision: "allow", level: "unknown" } });
    const delivered = await store("/orders/ord_1/deliver");
    expect(delivered.order.status).toBe("delivered");

    const second = await buy(agentKeyFile, "tee");
    expect(second).toMatchObject({ status: 201, order: { id: "ord_2" } });

    // An unsigned client is just a normal visitor: the store never asks Standing.
    const unsigned = await fetch(`${E2E.store}/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product: "mug" }) });
    expect(unsigned.status).toBe(201);
  });

  await test.step("business sees the checks and reports fraud from the dashboard", async () => {
    await business.goto("/dashboard/checks");
    const rows = business.getByTestId("check-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText("Completed");
    await expect(rows.nth(0)).toContainText("Acme Shopper");
    await expect(rows.nth(0)).toContainText("Allow");
    await shot(business, "checks");

    await rows.nth(0).click();
    const drawer = business.getByRole("dialog", { name: "Check" });
    await expect(drawer.getByText("Monitor mode — not enforced")).toBeVisible();
    await expect(drawer.getByText("Registered by Acme Agents (127.0.0.1:5110), domain verified.")).toBeVisible();
    await drawer.getByLabel("Your reference (optional)").fill("ord_2");
    await drawer.getByRole("button", { name: "Fraud" }).click();
    await expect(drawer.getByText(/Reported Fraud/)).toBeVisible();
    await shot(business, "check-drawer-reported");
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(rows.nth(0)).toContainText("Fraud");
  });

  await test.step("builder sees both reports and disputes the fraud report", async () => {
    await builder.goto("/dashboard");
    await expect(builder.getByRole("link", { name: /1 negative report about your agents/ })).toBeVisible();
    await builder.goto(`/dashboard/agents/${agentId}`);
    const reports = builder.getByTestId("report-row");
    await expect(reports).toHaveCount(2);
    const fraud = reports.filter({ hasText: "Fraud" });
    await expect(fraud).toContainText(businessHost);
    await fraud.getByRole("button", { name: "Dispute" }).click();
    const dialog = builder.getByRole("dialog", { name: "Dispute report" });
    await dialog.getByLabel("Why is this report wrong?").fill("The customer confirmed they placed order ord_2.");
    await dialog.getByRole("button", { name: "Send dispute" }).click();
    await expect(fraud).toContainText("Under dispute");
    await shot(builder, "agent-detail-disputed");
  });

  await test.step("business withdraws the disputed report", async () => {
    await business.goto("/dashboard/reports");
    const dispute = business.getByTestId("dispute");
    await expect(dispute).toContainText("The customer confirmed they placed order ord_2.");
    await expect(dispute).toContainText("ord_2");
    await shot(business, "reports-dispute");
    await dispute.getByRole("button", { name: "Withdraw" }).click();
    await expect(business.getByText("No open disputes")).toBeVisible();
  });

  await test.step("public page shows the owner and aggregate standing only", async () => {
    await business.goto(`/agents/${agentId}`);
    await expect(business.getByRole("heading", { name: "Acme Shopper" })).toBeVisible();
    await expect(business.getByText("Acme Agents · 127.0.0.1:5110")).toBeVisible();
    const standing = business.getByLabel("Standing");
    await expect(standing.getByText("Reports", { exact: true }).locator("..")).toContainText("1");
    await expect(standing.getByText("Negative", { exact: true }).locator("..")).toContainText("0");
    await expect(business.locator("body")).not.toContainText("ord_2");
    await expect(business.locator("body")).not.toContainText("Northwind");
    await shot(business, "public-agent");
  });

  await test.step("enforce mode with the published test agents, through the CLI", async () => {
    await business.goto("/dashboard/settings");
    await business.getByRole("radio", { name: "Enforce" }).click();
    await business.getByLabel("Agents in poor standing").selectOption("deny");
    await business.getByRole("button", { name: "Save", exact: true }).last().click();
    await expect(business.getByText("Saved", { exact: true })).toBeVisible();
    await store("/admin/config", { apiKey: testKey });

    const poorFile = `${ARTIFACTS}/test-poor.json`;
    const goodFile = `${ARTIFACTS}/test-good.json`;
    writeFileSync(poorFile, JSON.stringify(testAgentKey("poor", E2E.agentsHost)));
    writeFileSync(goodFile, JSON.stringify(testAgentKey("good", E2E.agentsHost)));

    const refused = await cli(["request", `${E2E.store}/checkout`, "-d", '{"product":"mug"}', "--key", poorFile]);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("403");
    expect(refused.stdout).toContain("Poor standing");

    const accepted = await cli(["request", `${E2E.store}/checkout`, "-d", '{"product":"mug"}', "--key", goodFile]);
    expect(accepted.code).toBe(0);
    expect(accepted.stdout).toContain("201");

    await business.goto("/dashboard/checks?mode=test");
    await expect(business.getByTestId("check-row")).toHaveCount(2);
    await expect(business.getByTestId("check-row").filter({ hasText: "Deny" })).toHaveCount(1);
    await shot(business, "checks-test-mode");
  });

  await test.step("builder registers a second agent with the CLI", async () => {
    const builderKey = await createKey(builder, "CLI", "Live");
    const env = { STANDING_API_KEY: builderKey };
    const created = await cli(["agent", "create", "Acme Researcher", "--out", `${ARTIFACTS}/cli-agent.json`], env);
    expect(created.code).toBe(0);
    expect(created.stdout).toMatch(/Created Acme Researcher \(agt_/);
    const list = await cli(["agent", "list"], env);
    expect(list.stdout).toContain("Acme Shopper");
    expect(list.stdout).toContain("Acme Researcher");
    const lookup = await cli(["lookup", agentId]);
    expect(lookup.stdout).toContain("Owner: Acme Agents (127.0.0.1:5110, verified)");
  });

  await test.step("revoking an agent makes every site deny it", async () => {
    await builder.goto(`/dashboard/agents/${agentId}`);
    await builder.getByRole("button", { name: "Revoke" }).click();
    await builder.getByRole("dialog", { name: "Revoke agent" }).getByRole("button", { name: "Revoke agent" }).click();
    await expect(builder.getByText("Revoked", { exact: true })).toBeVisible();

    await store("/admin/config", { apiKey: liveKey });
    const refused = await buy(agentKeyFile);
    expect(refused).toMatchObject({ status: 403, error: "Order refused.", reason: "The owner revoked this agent." });
  });

  await test.step("sign out and back in", async () => {
    await business.goto("/dashboard");
    await business.getByRole("button", { name: "Sign out" }).click();
    await expect(business).toHaveURL(/\/login$/);
    await business.getByLabel("Email").fill("ops@northwind.test");
    await business.getByLabel("Password").fill("wrong password!");
    await business.getByRole("button", { name: "Sign in" }).click();
    await expect(business.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
    await business.getByLabel("Password").fill("correct horse battery");
    await business.getByRole("button", { name: "Sign in" }).click();
    await expect(business.getByRole("heading", { name: "Overview" })).toBeVisible();
    await shot(business, "overview-after");
  });
});
