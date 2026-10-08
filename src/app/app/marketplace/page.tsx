import { redirect } from "next/navigation";
import { appMode } from "@/lib/page-auth";
import { MemberMarket } from "@/components/app/member-market";
import { StaffMarket } from "@/components/app/staff-market";
import { EmptyState } from "@/components/ui/misc";

export const metadata = { title: "Marketplace" };

export default async function Marketplace({ searchParams }: PageProps<"/app/marketplace">) {
  const mode = await appMode();
  const sp = await searchParams;
  if (mode.kind !== "member" && mode.kind !== "staff") redirect("/login");
  if (!mode.ctx.flags.marketplace) return <EmptyState title="Marketplace isn't on your plan" body="Ask GymPulse support about upgrading to add a marketplace for training packs, classes and gear." />;
  if (mode.kind === "member") return <MemberMarket ctx={mode.ctx} focus={typeof sp.product === "string" ? sp.product : undefined} />;
  if (!mode.ctx.can("marketplace.manage") && !mode.ctx.can("bookings.manage")) redirect("/app/forbidden");
  return <StaffMarket ctx={mode.ctx} tab={["products", "orders", "coupons"].includes(String(sp.tab)) ? String(sp.tab) : "products"} />;
}
