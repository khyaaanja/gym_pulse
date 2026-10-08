"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { CalendarCheck, HeartPulse, LayoutGrid, LogOut, Search, ShoppingBag, Users, LineChart, FileUp, FileText, Settings, RefreshCcw, Dumbbell, ClipboardList, House, Trophy, Megaphone, Salad, Rocket } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { PendingHint } from "@/components/ui/pending-hint";
import { api } from "@/lib/client";
import { GymSwitcher } from "./gym-switcher";
import { NotificationBell, NotificationsProvider } from "./notification-center";

const ICONS = { pulse: HeartPulse, attendance: CalendarCheck, renew: RefreshCcw, market: ShoppingBag, overview: LayoutGrid, members: Users, forecast: LineChart, imports: FileUp, reports: FileText, settings: Settings, bookings: Dumbbell, action: ClipboardList, home: House, trophy: Trophy, news: Megaphone, diet: Salad, grow: Rocket } as const;
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; primary?: boolean };

function isActive(path: string, href: string) {
  return href === "/app" ? path === "/app" : path === href || path.startsWith(href + "/");
}

export function AppShell({ nav, gymName, gymId, gyms = [], userName, role, staff, unread, notificationsLive = true, children }: { nav: NavItem[]; gymName: string; gymId: string; gyms?: { id: string; name: string; role: string }[]; userName: string; role: string; staff: boolean; unread: number; notificationsLive?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const primary = nav.filter((n) => n.primary);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    if (!staff) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [staff]);

  async function logout() {
    await api("/api/auth/logout", { body: {} }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  return (
    <NotificationsProvider initialUnread={unread} live={notificationsLive}>
    <div className="grid-cols-1 min-h-dvh lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Desktop / tablet sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <Logo href="/app" />
        {gyms.length > 1 ? <GymSwitcher gyms={gyms} current={gymId} className="mt-3" /> : <p className="mt-1 truncate pl-10 text-sm text-ink-3">{gymName}</p>}
        {staff && (
          <button onClick={() => setCmdOpen(true)} className="mt-6 flex h-10 items-center gap-2 rounded-xl bg-mist px-3 text-sm text-ink-3 ring-1 ring-line hover:text-ink">
            <Search className="size-4" /> Search
            <kbd className="ml-auto rounded-md bg-surface px-1.5 text-xs ring-1 ring-line">⌘K</kbd>
          </button>
        )}
        <nav className="mt-6 flex-1 space-y-6 overflow-y-auto" aria-label="Main">
          <NavGroup items={primary} path={path} />
          {nav.some((n) => !n.primary) && <NavGroup items={nav.filter((n) => !n.primary)} path={path} title="Manage" />}
        </nav>
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="text-xs text-ink-3">{role}</p>
          </div>
          <NotificationBell side="right" />
          <button onClick={logout} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Sign out">
            <LogOut className="size-5" />
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line/70 bg-mist/95 px-4 py-3 lg:hidden">
          <Logo href="/app" className="[&_span]:text-lg" />
          <div className="flex items-center gap-1">
            {staff && (
              <button onClick={() => setCmdOpen(true)} className="rounded-lg p-2 text-ink-2" aria-label="Search">
                <Search className="size-5" />
              </button>
            )}
            <NotificationBell />
            <Link href={staff ? "/app/more" : "/app/security"} className="rounded-lg p-2 text-ink-2" aria-label="Menu">
              <LayoutGrid className="size-5" />
            </Link>
          </div>
        </header>
        {gyms.length > 1 && <div className="border-b border-line/70 px-4 py-2 lg:hidden"><GymSwitcher gyms={gyms} current={gymId} /></div>}
        <main className="mx-auto w-full max-w-[1200px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12 lg:pt-10">{children}</main>
      </div>

      {/* The four primary mobile destinations */}
      <nav aria-label="Primary" style={{ gridTemplateColumns: `repeat(${Math.max(primary.length, 1)}, minmax(0, 1fr))`, paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }} className="fixed inset-x-3 bottom-3 z-30 grid rounded-[1.6rem] sm:inset-x-auto sm:left-1/2 sm:w-[30rem] sm:-translate-x-1/2 bg-deep/95 p-1.5 shadow-lift ring-1 ring-white/5 lg:hidden">
        {primary.map((n) => {
          const Icon = ICONS[n.icon];
          const active = isActive(path, n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition-colors", active ? "bg-brand text-brand-ink shadow-[0_8px_20px_-8px_var(--brand)]" : "text-deep-ink/75")}>
              <PendingHint />
              <Icon className="size-5" aria-hidden />
              {n.label}
            </Link>
          );
        })}
      </nav>

      {staff && <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} nav={nav} />}
    </div>
    </NotificationsProvider>
  );
}

function NavGroup({ items, path, title }: { items: NavItem[]; path: string; title?: string }) {
  return (
    <div>
      {title && <p className="mb-2 px-3 text-xs font-medium text-ink-3">{title}</p>}
      <ul className="space-y-0.5">
        {items.map((n) => {
          const Icon = ICONS[n.icon];
          const active = isActive(path, n.href);
          return (
            <li key={n.href}>
              <Link href={n.href} aria-current={active ? "page" : undefined} className={cn("relative flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors", active ? "bg-brand-soft font-semibold text-brand before:absolute before:left-0 before:top-2 before:h-6 before:w-1 before:rounded-r-full before:bg-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
                <PendingHint />
                <Icon className="size-[18px]" aria-hidden />
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Hit = { type: string; id: string; title: string; subtitle?: string; href: string };

function CommandMenu({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (o: boolean) => void; nav: NavItem[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const router = useRouter();
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      api<{ hits: Hit[] }>(`/api/gym/search?q=${encodeURIComponent(q)}`).then((r) => setHits(r.hits)).catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="Search GymPulse" shouldFilter={false} className="fixed left-1/2 top-[12vh] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-3xl bg-surface shadow-lift ring-1 ring-line" overlayClassName="fixed inset-0 z-40 bg-scrim">
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="size-4 text-ink-3" />
        <Command.Input value={q} onValueChange={setQ} placeholder="Search members, payments, orders, imports…" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3" />
      </div>
      <Command.List className="max-h-[50vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">{q.length < 2 ? "Type at least 2 characters." : "Nothing found."}</Command.Empty>
        {q.trim().length >= 2 && hits.length > 0 && (
          <Command.Group heading="Results" className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2">
            {hits.map((h) => (
              <Command.Item key={`${h.type}-${h.id}`} value={`${h.type}-${h.id}`} onSelect={() => go(h.href)} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink data-[selected=true]:bg-brand-soft">
                <span className="w-24 shrink-0 text-xs text-ink-3">{h.type}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>
                {h.subtitle && <span className="truncate text-xs text-ink-3">{h.subtitle}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {q.length < 2 && (
          <Command.Group heading="Go to" className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2">
            {nav.map((n) => (
              <Command.Item key={n.href} value={n.href} onSelect={() => go(n.href)} className="cursor-pointer rounded-xl px-3 py-2.5 text-sm text-ink data-[selected=true]:bg-brand-soft">
                {n.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
