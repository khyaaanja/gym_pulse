import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export default function Suspended() {
  return <EmptyState title="This gym's account is paused" body="Your GymPulse account is suspended, usually because of an unpaid subscription. Your data is safe. Contact GymPulse support to restore access." action={<Button asChild variant="secondary"><Link href="/app/settings?tab=billing">View billing</Link></Button>} />;
}
