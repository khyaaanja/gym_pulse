"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/client";

/** Rotating front-desk QR. Members scan it with their phone camera to check themselves in. */
export function KioskQr({ gymName, locationId }: { gymName: string; locationId?: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await api<{ url: string; expiresInSeconds: number }>(`/api/gym/kiosk-token${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ""}`);
        setImg(await QRCode.toDataURL(r.url, { margin: 1, width: 520, color: { dark: "#1a1530", light: "#ffffff" } }));
        setLeft(r.expiresInSeconds);
        setError(null);
        timer = setTimeout(load, r.expiresInSeconds * 1000 + 300);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load the check-in code.");
        timer = setTimeout(load, 10_000);
      }
    };
    void load();
    const tick = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [locationId]);
  return (
    <div className="grid min-h-dvh place-items-center bg-ink p-6 text-mist">
      <div className="text-center">
        <p className="display text-3xl font-semibold sm:text-5xl">Check in at {gymName}</p>
        <p className="mt-3 text-lg opacity-75">Open your phone camera and scan the code.</p>
        <div className="mx-auto mt-10 grid size-[min(80vw,480px)] place-items-center rounded-[2.5rem] bg-white p-6">
          {error ? <p className="text-risk">{error}</p> : img ? <img src={img} alt="Check-in QR code" className="size-full" /> : <div className="size-full animate-pulse rounded-3xl bg-surface-2" />}
        </div>
        <p className="num mt-6 text-sm opacity-60">New code in {left}s</p>
      </div>
    </div>
  );
}
