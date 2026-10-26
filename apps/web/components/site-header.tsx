import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="grid size-5 place-items-center rounded bg-zinc-900 text-[10px] font-bold text-white">
        S
      </span>
      Standing
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-5 text-zinc-600">
          <Link href="/docs" className="hover:text-zinc-900">
            Docs
          </Link>
          <Link href="/dashboard" className="hover:text-zinc-900">
            Dashboard
          </Link>
          <Link href="/login" className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
