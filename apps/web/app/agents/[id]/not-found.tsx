import { LookupForm } from "@/components/lookup-form";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-xl font-semibold">No agent with that ID</h1>
        <p className="mt-1 text-zinc-500">Check the ID and try again. Agent IDs start with agt_.</p>
        <div className="mt-6 max-w-md">
          <LookupForm />
        </div>
      </main>
    </>
  );
}
