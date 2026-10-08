import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { SelfCheckIn } from "./self-checkin";

export const metadata = { title: "Check in" };

export default async function CheckinLanding({ params }: PageProps<"/checkin/[token]">) {
  const { token } = await params;
  if (!(await getUserSession())) redirect(`/login?next=${encodeURIComponent(`/checkin/${token}`)}`);
  return <SelfCheckIn token={token} />;
}
