import Link from "next/link";
import { prisma } from "@/db/client";
import { Logo } from "@/components/brand/logo";
import { SignOut } from "@/components/app/sign-out";

/**
 * Shown when a signed-in account has no active place in any gym. Says why when we know (a closed membership, staff
 * access turned off) and always offers a way out, so a shared phone can switch accounts.
 */
export async function NoGym({ userId, userName }: { userId: string; userName: string }) {
  const [closedMembership, disabledStaff] = await Promise.all([
    prisma.member.findFirst({ where: { userId, archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, select: { gym: { select: { name: true } } } }),
    prisma.staffMember.findFirst({ where: { userId, active: false }, orderBy: { createdAt: "desc" }, select: { gym: { select: { name: true } } } }),
  ]);
  const first = userName.split(" ")[0] || "there";

  let title = "Your account isn't linked to a gym yet";
  let body = "Ask your gym to send you an invite link. Once you open it, your membership or staff access appears here.";
  if (closedMembership) {
    title = `Your membership at ${closedMembership.gym.name} is closed`;
    body = "Your gym has closed this membership, so there's nothing to show here right now. If that's a mistake, ask the front desk to reactivate it — you'll get straight back in with this account.";
  } else if (disabledStaff) {
    title = `Your access to ${disabledStaff.gym.name} is turned off`;
    body = "The gym owner has turned off your staff access. Ask them to switch it back on in Settings → Staff & permissions.";
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-surface p-7 shadow-card ring-1 ring-line/70">
        <Logo href="/" />
        <p className="mt-6 text-sm text-ink-3">Hi {first},</p>
        <h1 className="display mt-1 text-balance text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-ink-2">{body}</p>
        <div className="mt-6 grid gap-2">
          <SignOut />
          {!closedMembership && !disabledStaff && (
            <Link href="/signup" className="rounded-full px-4 py-2.5 text-center text-sm font-medium text-brand ring-1 ring-line hover:bg-brand-soft">
              Start your own gym on GymPulse
            </Link>
          )}
        </div>
        <p className="mt-5 text-xs text-ink-3">Signed in as {userName}. Signing out lets someone else use this device.</p>
      </div>
    </main>
  );
}
