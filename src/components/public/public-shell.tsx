import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/** Frame for public, signed-out pages about a gym (profile, join, directory). */
export function PublicShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh bg-mist text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/gyms" className="text-ink-2 hover:text-ink">Find a gym</Link>
          <Link href="/login" className="rounded-full bg-surface px-4 py-2 ring-1 ring-line hover:bg-surface-2">Sign in</Link>
        </nav>
      </header>
      <main className={wide ? "mx-auto max-w-5xl px-4 pb-16 sm:px-6" : "mx-auto max-w-xl px-4 pb-16 sm:px-6"}>{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-ink-3 sm:px-6">
        Powered by <Link href="/" className="font-medium text-ink-2 underline underline-offset-4">GymPulse</Link> · <Link href="/legal/privacy" className="underline underline-offset-4">Privacy</Link>
      </footer>
    </div>
  );
}
