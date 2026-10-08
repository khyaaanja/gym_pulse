import { redirect } from "next/navigation";
import { appMode } from "@/lib/page-auth";
import { MemberRenew } from "@/components/app/member-renew";
import { StaffRenew } from "@/components/app/staff-renew";

export const metadata = { title: "Renew" };

export default async function Renew({ searchParams }: PageProps<"/app/renew">) {
  const mode = await appMode();
  const sp = await searchParams;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
  if (mode.kind === "member") return <MemberRenew ctx={mode.ctx} notice={str(sp.payment, 20)} wantedPlanId={str(sp.plan, 40)} coupon={str(sp.coupon, 40)} welcome={sp.welcome === "1"} />;
  if (mode.kind !== "staff") redirect("/login");
  return <StaffRenew ctx={mode.ctx} status={["ALL", "FAILED", "PENDING"].includes(String(sp.status)) ? String(sp.status) : "ALL"} />;
}
