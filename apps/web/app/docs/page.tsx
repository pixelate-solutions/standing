import { TEST_AGENTS, testAgentKey } from "@standing/sdk/testing";
import { SiteHeader } from "@/components/site-header";
import { Code } from "@/components/ui";
import { API_PUBLIC_URL } from "@/lib/api";
import { agentSnippet, businessSnippet, cliSnippet } from "@/lib/snippets";

export const metadata = { title: "Docs" };

const SECTIONS = [
  ["how", "How it works"],
  ["businesses", "Check agents"],
  ["agents", "Register an agent"],
  ["test-agents", "Test agents"],
  ["standing", "How standing works"],
  ["disputes", "Disputes"],
  ["api", "API reference"],
  ["data", "Data and use"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 border-t border-zinc-200 pt-10 text-lg font-semibold tracking-tight first:border-0 first:pt-0">
      {children}
    </h2>
  );
}

const P = ({ children }: { children: React.ReactNode }) => <p className="leading-relaxed text-zinc-700">{children}</p>;
const C = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs">{children}</code>;

const expressSnippet = `import express from "express";
import { Standing } from "@standing/sdk";

const standing = new Standing({ apiKey: process.env.STANDING_API_KEY });
const app = express();

// Answers challenged agents with 401 and denied agents with 403 when enforcing.
app.post("/checkout", standing.middleware({ action: "checkout" }), (req, res) => {
  const check = req.standing; // null when the request is not from a signed agent
  // ... create the order, keep check?.id with it to report the outcome later
});`;

const selfHostedSnippet = `GET https://your-agent.example/.well-known/http-message-signatures-directory
{ "keys": [{ "kty": "OKP", "crv": "Ed25519", "x": "…" }] }

Signature-Agent: sig1="https://your-agent.example";type=directory`;

const checkRequest = `POST ${API_PUBLIC_URL}/v1/checks
Authorization: Bearer sd_live_…

{
  "method": "POST",
  "url": "https://shop.example/checkout",
  "headers": {
    "signature": "sig1=:…:",
    "signature-input": "sig1=(\\"@authority\\" \\"signature-agent\\";key=\\"sig1\\");created=…;keyid=\\"…\\";alg=\\"ed25519\\";expires=…;nonce=\\"…\\";tag=\\"web-bot-auth\\"",
    "signature-agent": "sig1=\\"https://agt-….agents.standing.dev\\";type=directory"
  },
  "action": "checkout"
}`;

const checkResponse = `{
  "id": "chk_…",
  "decision": "allow",            // allow | challenge | deny
  "enforced": false,              // false in monitor mode
  "mode": "live",
  "reasons": [
    { "code": "signature_valid", "message": "Signature verified." },
    { "code": "owner_verified", "message": "Registered by Acme (acme.com), domain verified." },
    { "code": "standing_good", "message": "Good standing across businesses that reported outcomes." }
  ],
  "agent": { "id": "agt_…", "name": "Acme shopper", "registered": true,
             "owner": { "name": "Acme", "domain": "acme.com", "verified": true }, "revoked": false, … },
  "standing": { "level": "good", "score": 91, "reports": 412, "reporters": 37,
                "negative": 3, "under_dispute": 0, "last_report_at": "…" },
  "signature": { "valid": true, "kid": "…" },
  "request": { "method": "POST", "authority": "shop.example", "path": "/checkout", "action": "checkout" },
  "counts": true,
  "outcome": null,
  "created_at": "…"
}`;

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/v1/checks", "Check a signed agent request. API key."],
  ["GET", "/v1/checks", "List your checks. ?mode, ?decision, ?agent, ?before, ?limit"],
  ["GET", "/v1/checks/:id", "One check."],
  ["POST", "/v1/checks/:id/outcome", "Report or update an outcome: completed, disputed, fraud, abuse. Optional reference."],
  ["GET", "/v1/agents/:id", "An agent's public record and standing. No key needed."],
  ["GET", "/v1/agents/:id/jwks", "An agent's public keys (also served at its own origin's well-known path)."],
  ["GET", "/v1/agents", "Your agents."],
  ["POST", "/v1/agents", "Register an agent: name, public_key (Ed25519 JWK), proof."],
  ["POST", "/v1/agents/:id/keys", "Add a key. DELETE /v1/agents/:id/keys/:kid removes one."],
  ["POST", "/v1/agents/:id/revoke", "Revoke an agent. Every check denies it afterwards."],
  ["GET", "/v1/agents/:id/reports", "Reports that affect your agent's standing."],
  ["POST", "/v1/reports/:check_id/dispute", "Dispute a report about your agent: note."],
  ["GET", "/v1/reports/disputed", "Disputes on your reports that need an answer."],
  ["POST", "/v1/reports/:check_id/resolve", "Answer a dispute: confirm or withdraw."],
];

export default function Docs() {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex max-w-5xl gap-12 px-6 py-10">
        <nav className="sticky top-10 hidden h-fit w-44 shrink-0 space-y-1.5 md:block" aria-label="Docs">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block text-zinc-500 hover:text-zinc-900">
              {label}
            </a>
          ))}
        </nav>

        <article className="min-w-0 flex-1 space-y-5">
          <h1 className="text-2xl font-semibold tracking-tight">Docs</h1>

          <H2 id="how">How it works</H2>
          <ol className="list-decimal space-y-2 pl-5 text-zinc-700">
            <li>An agent signs each request with its key, using Web Bot Auth (RFC 9421 HTTP Message Signatures). Agents that already sign for Cloudflare work unchanged.</li>
            <li>Your server sends the signature headers to Standing. Standing verifies the signature, finds the agent and its owner, and returns allow, challenge, or deny with the agent&apos;s standing.</li>
            <li>When you know how the interaction ended, you report it: completed, disputed payment, fraud, or abuse.</li>
            <li>Reports from businesses with verified domains shape the agent&apos;s standing, which every other site sees.</li>
          </ol>

          <H2 id="businesses">Check agents on your site</H2>
          <P>
            Create an API key in the dashboard, verify your domain, and add a check wherever an agent can act. Start with a test key and the <a href="#test-agents" className="underline">test agents</a>.
          </P>
          <Code label="npm install @standing/sdk">{businessSnippet()}</Code>
          <P>
            <C>check()</C> returns <C>null</C> for requests without a signature, so ordinary visitors are never sent to Standing. It only sends the headers the agent signed — never cookies or authorization headers.
          </P>
          <P>
            New accounts start in <strong>monitor</strong> mode: decisions are recorded but <C>blocked</C> is always false. Switch to <strong>enforce</strong> in Settings when you are ready. If Standing does not answer within 2 seconds, the check allows the request; pass <C>failClosed: true</C> to deny instead.
          </P>
          <Code label="Express">{expressSnippet}</Code>
          <P>
            Report outcomes with the check ID. You can update a report later, for example when a chargeback arrives. Your reports count toward standing only when you used a live key, the request was to your verified domain, and you do not own the agent.
          </P>

          <H2 id="agents">Register an agent</H2>
          <P>Register an agent in the dashboard or from the terminal. Either way the private key is created on your machine and Standing keeps only the public key.</P>
          <Code label="Terminal">{cliSnippet}</Code>
          <Code label="Sign requests">{agentSnippet()}</Code>
          <P>
            Keep the key file secret. To rotate, add a new key on the agent&apos;s page, deploy it, then remove the old one. Verify your organization&apos;s domain so sites see your agents as owned by a verified organization.
          </P>
          <P>Agents that publish their own Web Bot Auth key directory are recognised without registering. Their standing is tracked under the directory&apos;s URL, but they have no verified owner.</P>
          <Code label="Self-hosted keys" copy={false}>
            {selfHostedSnippet}
          </Code>

          <H2 id="test-agents">Test agents</H2>
          <P>These agents have fixed standing and published private keys. Sign with them while using a test API key. Live keys always deny them.</P>
          <ul className="space-y-1 text-zinc-700">
            {Object.entries(TEST_AGENTS).map(([k, a]) => (
              <li key={k}>
                <C>{a.id}</C> — {a.name.replace("Test agent ", "").replace(/[()]/g, "")}
              </li>
            ))}
          </ul>
          <Code label="Key file for agt_testpoor">{JSON.stringify(testAgentKey("poor"), null, 2)}</Code>
          <Code label="Or in code">{`import { testAgentKey } from "@standing/sdk/testing";\nconst agentFetch = createAgentFetch(testAgentKey("poor"));`}</Code>

          <H2 id="standing">How standing works</H2>
          <ul className="list-disc space-y-2 pl-5 text-zinc-700">
            <li>Only reports tied to a check with a verified signature count, from businesses with a verified domain, about requests to that domain. Businesses cannot report on their own agents.</li>
            <li>Each business&apos;s reports are summed and then scaled down logarithmically, so many independent businesses matter more than one business reporting often.</li>
            <li>Negative outcomes weigh more: disputed payment 2, abuse 10, fraud 20, against 1 for completed.</li>
            <li>Reports fade: completed and disputed-payment reports halve in weight every 180 days, fraud and abuse every 365 days.</li>
            <li>A business whose disputed reports are often withdrawn or left unanswered has less weight on future negative reports.</li>
            <li>
              Levels: <strong>good</strong> (score 80+), <strong>neutral</strong> (50–79), <strong>poor</strong> (below 50), <strong>new</strong> when there is too little evidence to judge. The number is shown only when a verified organization owns the agent.
            </li>
          </ul>

          <H2 id="disputes">Disputes</H2>
          <P>
            Owners see every report about their agents: the site, the action, the outcome, and when. They can dispute any negative report once, with a note. The business then has 30 days to confirm or withdraw it. If it does neither, the report is removed. Reports under dispute still count until they are resolved.
          </P>

          <H2 id="api">API reference</H2>
          <P>
            Base URL <C>{API_PUBLIC_URL}</C>. Authenticate with <C>Authorization: Bearer sd_test_…</C> or <C>sd_live_…</C>. Errors are <C>{`{ "error": { "code", "message" } }`}</C>.
          </P>
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            <table className="w-full text-left">
              <tbody className="divide-y divide-zinc-100">
                {ENDPOINTS.map(([method, path, description]) => (
                  <tr key={method + path}>
                    <td className="w-16 px-3 py-2 font-mono text-xs text-zinc-500">{method}</td>
                    <td className="px-3 py-2 font-mono text-xs">{path}</td>
                    <td className="px-3 py-2 text-zinc-600">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Code label="Request" copy={false}>
            {checkRequest}
          </Code>
          <Code label="Response" copy={false}>
            {checkResponse}
          </Code>
          <P>
            Reason codes: <C>signature_valid</C>, <C>owner_verified</C>, <C>owner_unverified</C>, <C>self_hosted</C>, <C>standing_good</C>, <C>standing_neutral</C>, <C>standing_poor</C>,{" "}
            <C>standing_unknown</C>, <C>unknown_key</C>, <C>directory_unavailable</C>, <C>signature_invalid</C>, <C>signature_expired</C>, <C>signature_replayed</C>, <C>key_revoked</C>, <C>agent_revoked</C>, <C>test_agent</C>.
          </P>

          <H2 id="data">Data and use</H2>
          <ul className="list-disc space-y-2 pl-5 text-zinc-700">
            <li>Standing scores agents and their keys, not people. Public pages show only totals, never which business reported what.</li>
            <li>For each check Standing stores the agent, the site, the path without its query string, the action, and the decision. It never receives cookies, request bodies, or customer details.</li>
            <li>Checks with no reported outcome are deleted after 90 days. Completed reports are deleted after a year, negative reports after two.</li>
            <li>Do not use standing to decide anyone&apos;s eligibility for credit, insurance, employment, or housing.</li>
          </ul>
        </article>
      </div>
    </>
  );
}
