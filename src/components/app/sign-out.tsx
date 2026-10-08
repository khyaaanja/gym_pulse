"use client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";

export function SignOut({ admin = false }: { admin?: boolean }) {
  const router = useRouter();
  return (
    <Button variant="ghost" className="w-full" onClick={async () => { await api(admin ? "/api/admin/auth/logout" : "/api/auth/logout", { body: {} }).catch(() => undefined); router.push(admin ? "/super-admin/login" : "/login"); router.refresh(); }}>
      <LogOut /> Sign out
    </Button>
  );
}
