import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireStaff } from "@/lib/page-auth";
import { Card } from "@/components/ui/card";
import { SignOut } from "@/components/app/sign-out";
import { PendingHint } from "@/components/ui/pending-hint";

export const metadata = { title: "More" };

/** Mobile menu for everything beyond the four primary tabs. */
export default async function More() {
  const ctx = await requireStaff();
  const links = [
    ctx.can("reports.view") && ["/app", "Overview"],
    ["/app/members", "Members"],
    ctx.can("bookings.manage") && ["/app/bookings", "Bookings"],
    (ctx.can("leads.manage") || ctx.can("promotions.manage")) && ["/app/grow", "Grow"],
    ctx.can("diet.manage") && ["/app/diet", "Diet plans"],
    ctx.can("prediction.view") && ctx.flags.churn_prediction && ["/app/forecast", "Know Your Gym"],
    ctx.can("imports.view") && ctx.flags.file_import && ["/app/imports", "Analyze Records"],
    ctx.can("reports.view") && ["/app/reports", "Reports"],
    ctx.can("settings.manage") && ["/app/announcements", "Announcements"],
    (ctx.can("settings.manage") || ctx.can("staff.manage")) && ["/app/settings", "Settings"],
    ["/app/notifications", "Notifications"],
    ["/app/security", "Account & security"],
  ].filter(Boolean) as [string, string][];
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="display text-3xl font-semibold">{ctx.gym.name}</h1>
      <Card>
        <ul className="divide-y divide-line">
          {links.map(([href, label]) => <li key={href}><Link href={href} className="relative flex items-center justify-between px-5 py-4 text-[15px]"><PendingHint />{label}<ChevronRight className="size-4 text-ink-3" /></Link></li>)}
        </ul>
      </Card>
      <SignOut />
    </div>
  );
}
