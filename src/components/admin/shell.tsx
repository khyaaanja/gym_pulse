"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { SignOut } from "@/components/app/sign-out";
import { cn } from "@/lib/utils";
import { PendingHint } from "@/components/ui/pending-hint";

export function AdminShell({ nav, name, role, mfaWarning, children }: { nav: { href: string; label: string }[]; name: string; role: string; mfaWarning: boolean; children: React.ReactNode }) {
  const path = usePathname();
  // The menu belongs to the page it was opened on, so it closes when the route changes rather than on the tap: closing
  // on the tap unmounts the link, and with it the pending hint, while the next page is still on its way.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const setOpen = (o: boolean) => setOpenAt(o ? path : null);
  const active = (h: string) => (h === "/super-admin" ? path === h : path.startsWith(h));
  const list = (
    <ul className="space-y-0.5">
      {nav.map((n) => (
        <li key={n.href}><Link href={n.href} onClick={() => { if (n.href === path) setOpen(false); }} aria-current={active(n.href) ? "page" : undefined} className={cn("relative block rounded-lg px-3 py-1.5 text-sm", active(n.href) ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-surface-2")}><PendingHint />{n.label}</Link></li>
      ))}
    </ul>
  );
  return (
    <div className="grid-cols-1 min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-line bg-surface px-3 py-5 lg:flex">
        <Logo href="/super-admin" className="px-2" />
        <p className="mt-1 px-2 pl-12 text-xs text-ink-3">Control center</p>
        <nav className="mt-6 flex-1" aria-label="Control center">{list}</nav>
        <div className="mt-4 border-t border-line pt-3 text-sm"><p className="px-2 font-medium">{name}</p><p className="px-2 text-xs text-ink-3">{role}</p><Link href="/super-admin/login/password" className="mt-2 block rounded-lg px-2 py-1.5 text-ink-2 hover:bg-surface-2">Change password</Link><SignOut admin /></div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-mist/95 px-4 py-3 lg:hidden">
          <Logo href="/super-admin" />
          <button onClick={() => setOpen(!open)} aria-label="Menu" className="rounded-lg p-2">{open ? <X /> : <Menu />}</button>
        </header>
        {open && <nav className="border-b border-line bg-surface p-3 lg:hidden">{list}<Link href="/super-admin/login/password" className="relative mt-2 block rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"><PendingHint />Change password</Link><SignOut admin /></nav>}
        {mfaWarning && <aside aria-label="Environment warning" className="bg-warn-soft px-6 py-2 text-sm text-warn">Development mode: two-step verification is not enforced for admins (ALLOW_ADMIN_WITHOUT_MFA=true). This is refused in production.</aside>}
        <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
