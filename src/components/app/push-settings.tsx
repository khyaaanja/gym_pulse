"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BellOff, BellRing, Smartphone } from "lucide-react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "error" }
  | { kind: "insecure" }
  | { kind: "ios-install" }
  | { kind: "not-configured" }
  | { kind: "blocked" }
  | { kind: "off"; publicKey: string; devices: number }
  | { kind: "on"; publicKey: string; devices: number; endpoint: string };

type Setup = { configured: boolean; publicKey: string | null; thisDevice: boolean; devices: number };

function keyBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function detect(): Promise<State> {
  if (!window.isSecureContext) return { kind: "insecure" };
  if (isIos() && !isStandalone()) return { kind: "ios-install" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { kind: "unsupported" };
  const reg = await navigator.serviceWorker.getRegistration("/");
  // No subscription can exist without permission, so only ask then. WebKit builds without a push backend (WPE, and
  // likely WebKitGTK browsers) reload the page when getSubscription() is called.
  const sub = Notification.permission === "granted" ? await reg?.pushManager.getSubscription() : null;
  const setup = await api<Setup>(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`);
  if (!setup.configured || !setup.publicKey) return { kind: "not-configured" };
  if (Notification.permission === "denied") return { kind: "blocked" };
  if (sub && setup.thisDevice && Notification.permission === "granted") return { kind: "on", publicKey: setup.publicKey, devices: setup.devices, endpoint: sub.endpoint };
  return { kind: "off", publicKey: setup.publicKey, devices: setup.devices };
}

/** Turns Web Push on or off for this browser, for the signed-in session. */
export function PushSettings() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => detect().then(setState).catch(() => setState({ kind: "error" })), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function enable(publicKey: string) {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error(permission === "denied" ? "Notifications are blocked for this site in your browser settings." : "Notifications weren't allowed.");
        return void (await reload());
      }
      const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const key = keyBytes(publicKey);
      let sub = await reg.pushManager.getSubscription();
      try {
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch {
        // A subscription made with an older server key can't be reused: replace it.
        await sub?.unsubscribe();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await api("/api/push", { body: sub.toJSON() });
      toast.success("Notifications are on for this device.");
      await reload();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable(endpoint: string) {
    setBusy(true);
    try {
      await api("/api/push", { method: "DELETE", body: { endpoint } });
      const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      await sub?.unsubscribe();
      toast.success("Notifications are off for this device.");
      await reload();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't turn off notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await api("/api/push/test", { body: {} });
      toast.success("Test sent — it should arrive in a few seconds.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <div className="h-16 animate-pulse rounded-xl bg-surface-2" />;

  const others = "devices" in state ? state.devices - (state.kind === "on" ? 1 : 0) : 0;
  const note = (icon: React.ReactNode, title: string, body: string) => (
    <div className="flex gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">{icon}</span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-ink-2">{body}</p>
      </div>
    </div>
  );

  switch (state.kind) {
    case "insecure":
      return note(<BellOff className="size-5" aria-hidden />, "Phone alerts need a secure connection", "Open GymPulse through its https:// address to turn on notifications for this device.");
    case "ios-install":
      return note(<Smartphone className="size-5" aria-hidden />, "Add GymPulse to your Home Screen first", "On iPhone and iPad, tap Share → Add to Home Screen, open GymPulse from there, then come back here to turn on notifications.");
    case "unsupported":
      return note(<BellOff className="size-5" aria-hidden />, "This browser can't receive notifications", "Try Chrome, Edge, Firefox, or Safari on a recent version.");
    case "error":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">{note(<BellOff className="size-5" aria-hidden />, "Couldn't check notification settings", "Check your connection and try again.")}</div>
          <Button variant="secondary" onClick={() => { setState({ kind: "loading" }); void reload(); }}>Retry</Button>
        </div>
      );
    case "not-configured":
      return note(<BellOff className="size-5" aria-hidden />, "Phone alerts aren't available yet", "Push notifications haven't been set up on this server.");
    case "blocked":
      return note(<BellOff className="size-5" aria-hidden />, "Notifications are blocked", "Allow notifications for this site in your browser's site settings, then reload this page.");
    case "off":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><BellRing className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Get alerts on this device</p>
            <p className="text-sm text-ink-2">At-risk members, renewals and payments — even when GymPulse is closed.{others > 0 && ` On for ${others} other device${others === 1 ? "" : "s"}.`}</p>
          </div>
          <Button onClick={() => enable(state.publicKey)} disabled={busy}>Turn on</Button>
        </div>
      );
    case "on":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ok-soft text-ok"><BellRing className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Notifications are on for this device</p>
            <p className="text-sm text-ink-2">They stop automatically when you sign out here.{others > 0 && ` Also on for ${others} other device${others === 1 ? "" : "s"}.`}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={test} disabled={busy}>Send test</Button>
            <Button variant="ghost" onClick={() => disable(state.endpoint)} disabled={busy}>Turn off</Button>
          </div>
        </div>
      );
  }
}
