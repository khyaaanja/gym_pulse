import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export default function Forbidden() {
  return <EmptyState title="You don't have access to that" body="Ask your gym owner if you need this permission." action={<Button asChild variant="secondary"><Link href="/app/pulse">Go to Pulse</Link></Button>} />;
}
