import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";
import { PolicyNote } from "@/components/legal/policy-note";
import { prisma } from "@/db/client";
import { getUserSession } from "@/lib/auth/session";

export const metadata = { title: "Name your gym" };

/** Second step of "Sign up with Google": the account exists, so only the gym's details are left. */
export default async function SignupGym({ searchParams }: PageProps<"/signup/gym">) {
  const { plan } = await searchParams;
  const planKey = typeof plan === "string" ? plan : undefined;
  const session = await getUserSession();
  if (!session) redirect(planKey ? `/signup?plan=${encodeURIComponent(planKey)}` : "/signup");
  if (await prisma.staffMember.findFirst({ where: { userId: session.userId, role: "OWNER" }, select: { id: true } })) redirect("/app");
  const first = session.user.name.split(" ")[0] || "there";

  return (
    <AuthShell title="Name your gym" subtitle={`Hi ${first}${session.user.email ? `, you're signed in as ${session.user.email}` : ""}. One last step.`}>
      <AuthForm
        endpoint="/api/auth/signup/gym"
        submit="Create gym"
        extra={planKey ? { plan: planKey } : undefined}
        fields={[
          { name: "gymName", label: "Gym name" },
          { name: "city", label: "City", required: false },
          { name: "phone", label: "Gym mobile", type: "tel", autoComplete: "tel", required: false, hint: "Nepal mobile, e.g. 98XXXXXXXX" },
        ]}
      />
      <PolicyNote kind="signup" className="mt-4" />
    </AuthShell>
  );
}
