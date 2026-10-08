import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";

export const metadata = { title: "Choose a new password" };

export default async function Reset({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Choose a new password" subtitle="You'll be signed out of other devices.">
      <AuthForm endpoint="/api/auth/password/reset" submit="Save password" extra={{ token: String(token ?? "") }} onSuccessMessage="Password saved. You can sign in now." fallbackRedirect="/login" fields={[{ name: "password", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 10 characters." }]} />
    </AuthShell>
  );
}
