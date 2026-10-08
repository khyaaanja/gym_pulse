import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { tenantDb } from "@/db/tenant";
import { livePromotions, publicGym } from "@/services/growth";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { PrintButton } from "@/app/app/receipts/[id]/print-button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gym = await publicGym((await params).slug);
  return { title: gym ? `${gym.name} poster` : "Gym not found", robots: { index: false } };
}

/** A printable A4 flyer with a QR code to the gym's page — for the notice board, the counter, or the chiya shop next door. */
export default async function Poster({ params, searchParams }: Props) {
  const gym = await publicGym((await params).slug);
  if (!gym) notFound();
  const sp = await searchParams;
  const [promotions, plans] = await Promise.all([
    livePromotions(gym.id, { publicOnly: true }),
    tenantDb(gym.id).membershipPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }], take: 3, select: { id: true, name: true, pricePaisa: true } }),
  ]);
  const promo = promotions.find((p) => p.id === sp.promo) ?? promotions[0];
  const url = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/g/${gym.slug}${promo ? `?promo=${promo.id}` : ""}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#1a1530", light: "#ffffff" } });

  return (
    <div className="min-h-dvh bg-mist py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 max-w-[210mm] px-4 print:hidden"><PrintButton /></div>
      <article className="mx-auto flex aspect-[210/297] max-w-[210mm] flex-col overflow-hidden bg-white text-[#1a1530] shadow-lift print:shadow-none">
        <header className="bg-dusk px-[8%] py-[7%] text-white">
          <p className="text-[clamp(14px,2.2vw,20px)] uppercase tracking-[0.2em] text-white/80">{gym.city ?? "Now open"}</p>
          <h1 className="display mt-2 text-[clamp(36px,7vw,72px)] font-extrabold leading-[1.02]">{gym.name}</h1>
          {gym.cfg.publicPage.tagline && <p className="mt-3 text-[clamp(16px,2.6vw,26px)] text-white/90">{gym.cfg.publicPage.tagline}</p>}
        </header>
        <div className="flex flex-1 flex-col gap-[5%] px-[8%] py-[6%]">
          {promo && (
            <section className="rounded-3xl border-4 border-[#b3135f] p-[5%]">
              {promo.badge && <p className="text-[clamp(14px,2vw,18px)] font-bold uppercase tracking-wider text-[#b3135f]">{promo.badge}</p>}
              <p className="display text-[clamp(26px,4.6vw,46px)] font-extrabold leading-tight">{promo.title}</p>
              {promo.description && <p className="mt-2 text-[clamp(14px,2.2vw,20px)]">{promo.description}</p>}
              <p className="mt-2 text-[clamp(14px,2vw,18px)]">{promo.coupon?.active ? `Use code ${promo.coupon.code}` : ""}{promo.endsAt ? ` · Ends ${formatDate(promo.endsAt, undefined, gym.timezone)}` : ""}</p>
            </section>
          )}
          {gym.cfg.publicPage.showPrices && plans.length > 0 && (
            <ul className="grid grid-cols-3 gap-3 text-center">
              {plans.map((p) => (
                <li key={p.id} className="rounded-2xl bg-[#f5f3f8] p-3">
                  <p className="text-[clamp(13px,1.8vw,17px)] font-semibold">{p.name}</p>
                  <p className="num display text-[clamp(18px,3vw,30px)] font-extrabold">{formatMoney(p.pricePaisa, gym.currencySymbol)}</p>
                </li>
              ))}
            </ul>
          )}
          <section className="mt-auto flex items-center gap-[6%]">
            <div className="w-[38%] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code linking to ${url}`} role="img" />
            <div>
              <p className="display text-[clamp(22px,3.8vw,38px)] font-extrabold leading-tight">Scan to book a free trial</p>
              <p className="mt-2 text-[clamp(13px,2vw,18px)]">or call {gym.phone ?? "the front desk"}</p>
              {gym.address && <p className="mt-1 text-[clamp(13px,2vw,18px)]">{gym.address}</p>}
              <p className="mt-3 break-all text-[clamp(11px,1.6vw,14px)] text-[#645c7a]">{url}</p>
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
