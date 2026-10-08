import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";

export default function Forgot() {
  return (
    <AuthShell title="Reset your password" subtitle="We'll send a reset link to your email or phone.">
      <AuthForm endpoint="/api/auth/password/forgot" submit="Send reset link" fields={[{ name: "identifier", label: "Email or phone" }]} />
    </AuthShell>
  );
}
