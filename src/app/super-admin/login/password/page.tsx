import { redirect } from "next/navigation";
import { adminSetupStep, getAdminSession } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";

export const metadata = { title: "Change password" };

/** Replaces a temporary password before the console opens; also where any admin changes their password. */
export default async function AdminPassword() {
  const s = await getAdminSession("partial");
  if (!s) redirect("/super-admin/login");
  if (adminSetupStep(s) === "/super-admin/login/mfa") redirect("/super-admin/login/mfa");
  const forced = s.admin.mustResetPassword;
  return (
    <AuthShell title={forced ? "Choose a new password" : "Change your password"} subtitle={forced ? "Your account was set up with a temporary password. Replace it to open the control center." : "This signs you out of the control center on your other devices."}>
      <AuthForm
        endpoint="/api/admin/auth/password"
        submit="Save password"
        fields={[
          { name: "current", label: forced ? "Temporary password" : "Current password", type: "password", autoComplete: "current-password" },
          { name: "next", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 10 characters." },
        ]}
      />
    </AuthShell>
  );
}
