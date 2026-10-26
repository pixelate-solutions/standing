import Link from "next/link";
import { LookupForm } from "@/components/lookup-form";
import { SiteHeader } from "@/components/site-header";

const steps = [
  ["Agents sign their requests", "Each request carries a Web Bot Auth signature tied to a registered key and its owner."],
  ["Sites check the agent", "One API call verifies the signature and returns allow, challenge, or deny with the agent's standing."],
  ["Sites report what happened", "Completed, disputed payment, fraud, or abuse. Only verified businesses' reports count."],
  ["Standing follows the agent", "Every site sees the same record. Owners can see each report and dispute it."],
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6">
        <section className="py-20">
          <h1 className="max-w-xl text-3xl font-semibold tracking-tight">Look up an AI agent</h1>
          <p className="mt-2 max-w-xl text-zinc-500">See who owns it and how it has behaved at other sites.</p>
          <div className="mt-6 max-w-xl">
            <LookupForm />
          </div>
        </section>

        <section className="grid gap-4 border-t border-zinc-200 py-12 md:grid-cols-2">
          <Link href="/docs#businesses" className="rounded-lg border border-zinc-200 p-5 hover:border-zinc-400">
            <h2 className="font-semibold">Check agents on your site</h2>
            <p className="mt-1 text-zinc-500">Add one call before checkout, sign-up, or any action an agent can take.</p>
          </Link>
          <Link href="/docs#agents" className="rounded-lg border border-zinc-200 p-5 hover:border-zinc-400">
            <h2 className="font-semibold">Register your agent</h2>
            <p className="mt-1 text-zinc-500">Give it a key, sign its requests, and build a record sites can trust.</p>
          </Link>
        </section>

        <section className="border-t border-zinc-200 py-12">
          <h2 className="font-semibold">How it works</h2>
          <ol className="mt-4 grid gap-6 md:grid-cols-4">
            {steps.map(([title, body], i) => (
              <li key={title}>
                <span className="font-mono text-xs text-zinc-400">{i + 1}</span>
                <h3 className="mt-1 font-medium">{title}</h3>
                <p className="mt-1 text-zinc-500">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
