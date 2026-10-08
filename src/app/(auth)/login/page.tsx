import Link from "next/link";
import { AuthShell } from "@/components/auth/shell";
import { AuthForm } from "@/components/auth/forms";
import { GoogleButton, OrDivider, googleError } from "@/components/auth/google-button";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const problem = googleError(error);
  return (
    <AuthShell
      title="Sign in"
      subtitle="Gym owners, staff, trainers and members all sign in here."
      footer={
        <>
          <Link className="font-medium text-brand underline underline-offset-4" href="/forgot-password">Forgot your password?</Link>
          <span className="mx-2">·</span>New gym? <Link className="font-medium text-brand underline underline-offset-4" href="/signup">Start a free trial</Link>
          <p className="mt-2">Want to join a gym? <Link className="font-medium text-brand underline underline-offset-4" href="/gyms">Find your gym</Link></p>
        </>
      }
    >
      {problem && <p role="alert" className="mb-4 rounded-xl bg-risk-soft px-3.5 py-2.5 text-sm text-risk">{problem}</p>}
      <GoogleButton next={nextPath} />
      <OrDivider />
      <AuthForm next={nextPath} endpoint="/api/auth/login" submit="Sign in" fields={[{ name: "identifier", label: "Email or phone", autoComplete: "username" }, { name: "password", label: "Password", type: "password", autoComplete: "current-password" }]} />
    </AuthShell>
  );
}
