import { redirect } from "next/navigation";
import { appMode } from "@/lib/page-auth";
import { OwnerDashboard } from "@/components/app/owner-dashboard";
import { MemberHome } from "@/components/app/member-home";

export const metadata = { title: "Overview" };

export default async function AppHome({ searchParams }: PageProps<"/app">) {
  const mode = await appMode();
  if (mode.kind === "member") return <MemberHome ctx={mode.ctx} />;
  if (mode.kind !== "staff") redirect("/login");
  if (mode.ctx.gym.status === "SUSPENDED" || mode.ctx.gym.status === "ARCHIVED") redirect("/app/suspended");
  if (!mode.ctx.gym.onboardedAt && mode.ctx.staff.role === "OWNER") redirect("/app/onboarding");
  if (!mode.ctx.can("reports.view")) redirect("/app/pulse");
  const { range } = await searchParams;
  return <OwnerDashboard ctx={mode.ctx} range={["today", "7d", "30d", "90d"].includes(String(range)) ? String(range) : "30d"} />;
}
