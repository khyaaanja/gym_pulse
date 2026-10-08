import { requireStaff } from "@/lib/page-auth";
import { KioskQr } from "@/components/app/kiosk-qr";

export const metadata = { title: "Check-in kiosk" };

export default async function Kiosk({ searchParams }: PageProps<"/app/kiosk">) {
  const ctx = await requireStaff("attendance.create");
  const { location } = await searchParams;
  const branch = typeof location === "string" ? await ctx.db.location.findFirst({ where: { id: location, active: true }, select: { id: true, name: true } }) : null;
  return <div className="fixed inset-0 z-50"><KioskQr gymName={branch ? `${ctx.gym.name} · ${branch.name}` : ctx.gym.name} locationId={branch?.id} /></div>;
}
