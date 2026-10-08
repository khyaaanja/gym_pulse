"use client";
import { ActionButton } from "@/components/ui/action-button";

/** Makes this gym the active one (a POST, never a side effect of opening a page), then opens the app. */
export function SwitchGymButton({ gymId }: { gymId: string }) {
  return <ActionButton size="lg" className="mt-6" endpoint="/api/auth/switch-gym" body={{ gymId }} redirectTo="/app">Open the app</ActionButton>;
}
