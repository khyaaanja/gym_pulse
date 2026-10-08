import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";
import { MfaSetup } from "@/components/app/mfa-setup";

export default async function AdminMfa() {
  const s = await getAdminSession("partial");
  if (!s) redirect("/super-admin/login");
  if (!s.admin.mfaEnabled) {
    return (
      <AuthShell title="Set up two-step verification" subtitle="Required for everyone with access to the control center.">
        <MfaSetup base="/api/admin/auth/mfa" done="/super-admin" />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Enter your code" subtitle="From your authenticator app.">
      <AuthForm endpoint="/api/admin/auth/mfa/verify" submit="Verify" fields={[{ name: "code", label: "6-digit code", autoComplete: "one-time-code", inputMode: "numeric" }]} />
    </AuthShell>
  );
}
