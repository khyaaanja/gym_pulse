import Link from "next/link";
import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";
import { PolicyNote } from "@/components/legal/policy-note";
import { Button } from "@/components/ui/button";
import { prisma } from "@/db/client";
import { getUserSession } from "@/lib/auth/session";
import { inviteByToken } from "@/services/invites";

export default async function Invite({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await inviteByToken(token);
  if (!invite) return <AuthShell title="This invitation has expired" subtitle="Ask your gym to send a new one." >{null}</AuthShell>;
  const role = invite.role === "MEMBER" ? "member" : invite.role.toLowerCase();
  const title = `Join ${invite.gym.name}`;
  const endpoint = `/api/auth/invite/${token}`;

  // An address that already has an account is accepted by signing in to it, not by entering its password here.
  const existing = await prisma.user.findFirst({ where: { OR: [...(invite.email ? [{ email: invite.email }] : []), ...(invite.phone ? [{ phone: invite.phone }] : [])] }, select: { id: true } });
  if (existing) {
    const session = await getUserSession();
    if (session?.userId === existing.id) {
      return (
        <AuthShell title={title} subtitle={`You've been invited as a ${role}. You're signed in as ${session.user.name}.`}>
          <AuthForm endpoint={endpoint} submit={`Join as ${role}`} fields={[]} />
        </AuthShell>
      );
    }
    return (
      <AuthShell title={title} subtitle={`You've been invited as a ${role}. You already have a GymPulse account — sign in to accept.`}>
        <Button asChild className="w-full" size="lg"><Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to accept</Link></Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={title} subtitle={`You've been invited as a ${role}. Create your account to continue.`}>
      <AuthForm endpoint={endpoint} submit="Create account" fields={[{ name: "name", label: "Your name", autoComplete: "name" }, { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 10 characters." }]} />
      <PolicyNote kind="invite" className="mt-4" />
    </AuthShell>
  );
}
