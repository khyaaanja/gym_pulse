import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";

export const metadata = { title: "Control center sign in" };

export default function AdminLogin() {
  return (
    <AuthShell title="GymPulse control center" subtitle="Platform staff only. Every action here is audited.">
      <AuthForm endpoint="/api/admin/auth/login" submit="Sign in" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "username" }, { name: "password", label: "Password", type: "password", autoComplete: "current-password" }]} />
    </AuthShell>
  );
}
