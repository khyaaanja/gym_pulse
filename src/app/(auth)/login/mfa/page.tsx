import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";

export default function Mfa() {
  return (
    <AuthShell title="Enter your code" subtitle="Open your authenticator app and enter the 6-digit code for GymPulse.">
      <AuthForm endpoint="/api/auth/mfa/verify" submit="Verify" fields={[{ name: "code", label: "6-digit code", autoComplete: "one-time-code", inputMode: "numeric" }]} />
    </AuthShell>
  );
}
