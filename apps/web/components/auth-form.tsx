"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "./site-header";
import { Button, Field, Input, Notice } from "./ui";
import { api } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${mode}`, { body: Object.fromEntries(form) });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <form
          className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
        >
          <h1 className="text-lg font-semibold">{mode === "login" ? "Sign in" : "Create an account"}</h1>
          {mode === "signup" && (
            <Field label="Organization name" htmlFor="name">
              <Input id="name" name="name" required autoComplete="organization" />
            </Field>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 10 characters." : undefined}>
            <Input id="password" name="password" type="password" required minLength={mode === "signup" ? 10 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          </Field>
          {error && <Notice tone="red">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-zinc-500">
          {mode === "login" ? (
            <>
              No account?{" "}
              <Link href="/signup" className="font-medium text-zinc-900 underline">
                Create one
              </Link>
            </>
          ) : (
            <>
              Have an account?{" "}
              <Link href="/login" className="font-medium text-zinc-900 underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
