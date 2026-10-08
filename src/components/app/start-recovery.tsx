"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { act, api } from "@/lib/client";

export function StartRecovery({ memberId }: { memberId: string }) {
  const router = useRouter();
  return (
    <Button size="sm" onClick={async () => { const r = await act(() => api<{ task: { id: string } }>("/api/gym/recovery", { body: { memberId } }), "Recovery started"); if (r) router.push(`/app/members/${memberId}`); }}>
      Start recovery
    </Button>
  );
}
