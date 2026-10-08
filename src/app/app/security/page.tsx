import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { FormDialog } from "@/components/ui/form-dialog";
import { Button } from "@/components/ui/button";
import { MfaSetup } from "@/components/app/mfa-setup";
import { SignOut } from "@/components/app/sign-out";
import { prisma } from "@/db/client";
import { GoogleButton, googleError } from "@/components/auth/google-button";
import { ActionButton } from "@/components/ui/action-button";
import { googleConfigured } from "@/lib/auth/google";

export const metadata = { title: "Account & security" };

export default async function Security({ searchParams }: PageProps<"/app/security">) {
  const s = await getUserSession({ allowSetup: true });
  if (!s) redirect("/login");
  const sp = await searchParams;
  const google = await prisma.oAuthAccount.findFirst({ where: { userId: s.userId, provider: "google" }, select: { email: true } });
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Account & security" description={`${s.user.name} · ${s.user.email ?? s.user.phone ?? ""}`} />
      {sp.reset && <p className="rounded-2xl bg-warn-soft p-4 text-sm text-warn">Please choose a new password before continuing.</p>}
      {sp.enroll && <p className="rounded-2xl bg-warn-soft p-4 text-sm text-warn">Your gym requires two-step verification. Set it up below.</p>}
      <Card>
        <CardHeader title="Password" description="Changing it signs you out on your other devices." />
        <CardBody>
          {!s.user.passwordHash ? (
            <p className="text-sm text-ink-2">You sign in with Google, so there&apos;s no password on this account. To add one, sign out and use &quot;Forgot your password?&quot; with {s.user.email ?? "your email"}.</p>
          ) : (
          <FormDialog trigger={<Button variant="secondary">Change password</Button>} title="Change password" endpoint="/api/auth/password/change" successMessage="Password changed" fields={[{ name: "current", label: "Current password", type: "password", required: true }, { name: "next", label: "New password", type: "password", required: true, hint: "At least 10 characters." }]} />
          )}
        </CardBody>
      </Card>
      {(google || googleConfigured()) && (
        <Card>
          <CardHeader title="Google sign-in" description="Sign in with one tap using your Google account." />
          <CardBody>
            {googleError(sp.error) && <p role="alert" className="mb-3 rounded-xl bg-risk-soft px-3.5 py-2.5 text-sm text-risk">{googleError(sp.error)}</p>}
            {sp.google === "connected" && <p role="status" className="mb-3 rounded-xl bg-ok-soft px-3.5 py-2.5 text-sm text-ok">Google is connected.</p>}
            {google ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-ok">Connected · {google.email}</p>
                {s.user.passwordHash && <ActionButton size="sm" variant="ghost" method="DELETE" endpoint="/api/auth/google" confirm="Disconnect Google? You'll sign in with your password." success="Google disconnected">Disconnect</ActionButton>}
              </div>
            ) : <GoogleButton link label="Connect Google" />}
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Two-step verification" description="Use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) for a code at sign-in." />
        <CardBody>{s.user.mfaEnabled ? <p className="text-sm font-medium text-ok">On</p> : <MfaSetup />}</CardBody>
      </Card>
      <SignOut />
    </div>
  );
}
