"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Copies text; falls back to a prompt where the clipboard API is missing or blocked. `navigator.clipboard` is
 * undefined outside secure contexts (plain-HTTP LAN installs), so every copy action must go through here.
 */
export async function copyText(text: string, message = "Copied"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
    return true;
  } catch {
    window.prompt("Copy this:", text);
    return false;
  }
}

/** Copies a link or message; falls back to a prompt where the clipboard API is blocked (plain-HTTP LAN installs). */
export function CopyButton({ text, label = "Copy link", ...props }: ButtonProps & { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      {...props}
      onClick={async () => {
        if (!(await copyText(text))) return;
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}
