"use client";

import { BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount } from "@/components/account-context";
import { Button, Card, Code, Field, Input, Notice, PageHeader, Segmented, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { Account, Policy } from "@/lib/types";

function useSave() {
  const [state, setState] = useState<{ busy: boolean; error: string | null; saved: boolean }>({ busy: false, error: null, saved: false });
  const run = async (fn: () => Promise<void>) => {
    setState({ busy: true, error: null, saved: false });
    try {
      await fn();
      setState({ busy: false, error: null, saved: true });
    } catch (e) {
      setState({ busy: false, error: (e as Error).message, saved: false });
    }
  };
  return { ...state, run };
}

function Organization() {
  const { account, setAccount } = useAccount();
  const [name, setName] = useState(account.name);
  const save = useSave();
  return (
    <Card title="Organization">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.run(async () => setAccount((await api<{ account: Account }>("/account", { method: "PATCH", body: { name } })).account));
        }}
      >
        <div className="flex-1">
          <Field label="Name" htmlFor="org-name" hint="Shown as the owner of your agents.">
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={save.busy || name === account.name} className="mb-5">
          {save.saved ? "Saved" : "Save"}
        </Button>
      </form>
      {save.error && <Notice tone="red">{save.error}</Notice>}
    </Card>
  );
}

function Domain() {
  const { account, setAccount, refresh } = useAccount();
  const [domain, setDomain] = useState(account.domain ?? "");
  const save = useSave();
  const verify = useSave();

  return (
    <Card
      title="Domain"
      description="Proves your organization runs this site. Your reports count toward agents' standing only for requests to this domain, and your agents show a verified owner."
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.run(async () => setAccount((await api<{ account: Account }>("/account", { method: "PATCH", body: { domain: domain || null } })).account));
        }}
      >
        <div className="flex-1">
          <Field label="Domain" htmlFor="domain">
            <Input id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" spellCheck={false} />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={save.busy || domain === (account.domain ?? "")}>
          Save
        </Button>
      </form>
      {save.error && (
        <div className="mt-3">
          <Notice tone="red">{save.error}</Notice>
        </div>
      )}

      {account.domain && account.domain_verified && (
        <p className="mt-4 flex items-center gap-1.5 text-emerald-700">
          <BadgeCheck size={16} /> {account.domain} is verified.
        </p>
      )}

      {account.domain && !account.domain_verified && (
        <div className="mt-5 space-y-3">
          <p className="font-medium">Verify {account.domain} with either method:</p>
          <p className="text-zinc-600">1. Add a DNS TXT record</p>
          <Code label={`_standing.${account.domain.replace(/:\d+$/, "")}`}>{account.domain_token}</Code>
          <p className="text-zinc-600">2. Or serve this text at a URL</p>
          <Code label={`https://${account.domain}/.well-known/standing-verification.txt`}>{account.domain_token}</Code>
          <Button
            onClick={() =>
              verify.run(async () => {
                setAccount((await api<{ account: Account }>("/account/verify-domain", { body: {} })).account);
                refresh();
              })
            }
            disabled={verify.busy}
          >
            {verify.busy ? "Checking…" : "Verify domain"}
          </Button>
          {verify.error && <Notice tone="red">{verify.error}</Notice>}
        </div>
      )}
    </Card>
  );
}

function PolicySettings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const save = useSave();
  useEffect(() => {
    api<{ policy: Policy }>("/account/policy").then((r) => setPolicy(r.policy));
  }, []);
  if (!policy) return null;
  const set = (patch: Partial<Policy>) => setPolicy({ ...policy, ...patch });
  const actions = (
    <>
      <option value="allow">Allow</option>
      <option value="challenge">Challenge</option>
      <option value="deny">Deny</option>
    </>
  );

  return (
    <Card title="Decisions" description="How checks decide. Invalid or replayed signatures and revoked agents are always denied. Keys Standing cannot find are challenged.">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.run(async () => setPolicy((await api<{ policy: Policy }>("/account/policy", { method: "PUT", body: policy })).policy));
        }}
      >
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Mode</span>
          <Segmented
            label="Mode"
            value={policy.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: "monitor", label: "Monitor" },
              { value: "enforce", label: "Enforce" },
            ]}
          />
          <p className="text-xs text-zinc-500">
            {policy.mode === "monitor" ? "Decisions are recorded but the SDK never blocks. Start here." : "The SDK blocks challenged and denied agents."}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New agents (too little history)" htmlFor="unknown">
            <Select id="unknown" value={policy.unknown_action} onChange={(e) => set({ unknown_action: e.target.value as Policy["unknown_action"] })} className="w-full">
              {actions}
            </Select>
          </Field>
          <Field label="Agents in poor standing" htmlFor="poor">
            <Select id="poor" value={policy.poor_action} onChange={(e) => set({ poor_action: e.target.value as Policy["poor_action"] })} className="w-full">
              {actions}
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.busy}>
            Save
          </Button>
          {save.saved && <span className="text-emerald-700">Saved</span>}
        </div>
        {save.error && <Notice tone="red">{save.error}</Notice>}
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Organization />
        <Domain />
        <PolicySettings />
      </div>
    </>
  );
}
