"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Popover as P } from "radix-ui";
import { toast } from "sonner";
import { Bell, CalendarCheck, CheckCheck, HeartPulse, Settings, ShieldCheck, ShoppingBag, Trophy, Wallet, RefreshCcw, UserMinus } from "lucide-react";
import { api } from "@/lib/client";
import { RelTime } from "@/components/ui/format";
import { cn } from "@/lib/utils";

export type InboxItem = { id: string; category: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

const CATEGORY_ICON: Record<string, typeof Bell> = {
  AT_RISK: HeartPulse,
  RENEWAL: RefreshCcw,
  PAYMENT: Wallet,
  MARKETPLACE: ShoppingBag,
  MILESTONE: Trophy,
  INACTIVITY: UserMinus,
  BOOKING: CalendarCheck,
  SYSTEM: ShieldCheck,
};
export const categoryIcon = (c: string) => CATEGORY_ICON[c] ?? Bell;

const POLL_MS = 30_000;
/** Full navigation: /app/n/:id is a route handler (marks read, then redirects), not a page the router can render. */
const go = (path: string) => window.location.assign(new URL(path, window.location.origin).href);
const PEEK = 8;

type Ctx = { unread: number; items: InboxItem[] | null; refresh: () => Promise<void>; markAllRead: () => Promise<void> };
const NotificationsContext = createContext<Ctx | null>(null);

/**
 * One live source for the unread count, shared by every bell in the shell. Refreshes every 30s while the
 * tab is visible, on focus, and instantly when the service worker relays a push. New arrivals get a toast,
 * and installed apps show the unread count on their icon. With `live` off (account setup still pending, where the
 * notifications API refuses and the client would redirect back to setup) it makes no requests and shows an empty inbox.
 */
export function NotificationsProvider({ initialUnread, live = true, children }: { initialUnread: number; live?: boolean; children: React.ReactNode }) {
  const [unread, setUnread] = useState(live ? initialUnread : 0);
  const [items, setItems] = useState<InboxItem[] | null>(live ? null : []);
  const seen = useRef<Set<string> | null>(null);
  const inflight = useRef(false);

  const apply = useCallback((res: { items: InboxItem[]; unread: number }) => {
    setItems(res.items);
    setUnread(res.unread);
    if (seen.current) {
      const fresh = res.items.filter((i) => !i.readAt && !seen.current!.has(i.id));
      if (fresh.length > 2) toast(`${fresh.length} new notifications`, { action: { label: "View", onClick: () => go("/app/notifications") } });
      else for (const n of fresh) toast(n.title, { description: n.body, action: { label: "Open", onClick: () => go(`/app/n/${n.id}`) } });
    }
    seen.current = new Set([...(seen.current ?? []), ...res.items.map((i) => i.id)]);
  }, []);

  const refresh = useCallback(() => {
    if (!live || inflight.current) return Promise.resolve();
    inflight.current = true;
    return api<{ items: InboxItem[]; unread: number }>(`/api/notifications?limit=${PEEK}`)
      .then(apply)
      .catch(() => undefined) // offline or signed out: keep the last known state; the next tick tries again
      .finally(() => {
        inflight.current = false;
      });
  }, [apply, live]);

  const markAllRead = useCallback(async () => {
    if (!live) return;
    setUnread(0);
    setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
    await api("/api/notifications", { body: { all: true } }).catch(() => toast.error("Couldn't mark notifications as read."));
    void refresh();
  }, [refresh, live]);

  useEffect(() => {
    if (!live) return;
    void refresh();
    const tick = () => document.visibilityState === "visible" && void refresh();
    const timer = window.setInterval(tick, POLL_MS);
    const onMessage = (e: MessageEvent) => e.data?.type === "gp:notification" && void refresh();
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [refresh, live]);

  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    (unread > 0 ? nav.setAppBadge(unread) : nav.clearAppBadge?.())?.catch(() => undefined);
  }, [unread]);

  return <NotificationsContext.Provider value={{ unread, items, refresh, markAllRead }}>{children}</NotificationsContext.Provider>;
}

function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("NotificationBell must be inside NotificationsProvider");
  return ctx;
}

/** Bell with a live count; opens a quick-look panel of the latest notifications. */
export function NotificationBell({ className, side = "bottom" }: { className?: string; side?: "top" | "bottom" | "right" }) {
  const { unread, items, refresh, markAllRead } = useNotifications();
  const count = unread > 99 ? "99+" : String(unread);
  return (
    <P.Root onOpenChange={(open) => open && void refresh()}>
      <P.Trigger className={cn("relative rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink", className)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="num absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-risk px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface" aria-hidden>
            {count}
          </span>
        )}
      </P.Trigger>
      <P.Portal>
        <P.Content
          side={side}
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-[min(34rem,80dvh)] w-[min(24rem,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl bg-surface shadow-lift ring-1 ring-line focus:outline-none data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.2,0,0,1)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-semibold">Notifications{unread > 0 && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{count} new</span>}</h2>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-brand hover:bg-brand-soft">
                <CheckCheck className="size-4" aria-hidden /> Mark all read
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items === null ? (
              <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />)}
              </div>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"><Bell className="size-5" aria-hidden /></span>
                <p className="mt-3 font-medium">You&apos;re all caught up</p>
                <p className="mt-1 text-sm text-ink-3">New alerts will show up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => <InboxRow key={n.id} n={n} compact />)}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm">
            <P.Close asChild>
              <a href="/app/notifications" className="font-medium text-brand hover:underline">See all</a>
            </P.Close>
            <P.Close asChild>
              <a href="/app/notifications#preferences" className="inline-flex items-center gap-1.5 text-ink-3 hover:text-ink">
                <Settings className="size-4" aria-hidden /> Settings
              </a>
            </P.Close>
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** One notification. A plain <a> (never prefetched) through /app/n/:id, which marks it read, then follows its link. */
export function InboxRow({ n, compact = false }: { n: InboxItem; compact?: boolean }) {
  const Icon = CATEGORY_ICON[n.category] ?? Bell;
  const unread = !n.readAt;
  return (
    <li>
      <a href={`/app/n/${n.id}`} className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", !compact && "px-5 py-4", unread && "bg-brand-soft/40")}>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", unread ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-3")}><Icon className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className={cn("min-w-0 flex-1", unread ? "font-semibold" : "font-medium")}>{unread && <span className="sr-only">Unread: </span>}{n.title}</span>
            {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />}
          </span>
          <span className={cn("block text-sm text-ink-2", compact && "line-clamp-2")}>{n.body}</span>
          <span className="mt-1 block text-xs text-ink-3"><RelTime date={n.createdAt} /></span>
        </span>
      </a>
    </li>
  );
}
