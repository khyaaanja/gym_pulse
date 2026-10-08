"use client";
import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, className, align = "end" }: { children: React.ReactNode; className?: string; align?: "start" | "end" }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "z-50 min-w-48 rounded-2xl bg-surface p-1.5 shadow-lift ring-1 ring-line focus:outline-none",
          "origin-(--radix-dropdown-menu-content-transform-origin) data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.2,0,0,1)]",
          className,
        )}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({ className, tone, ...p }: React.ComponentProps<typeof M.Item> & { tone?: "risk" }) {
  return (
    <M.Item
      className={cn(
        "flex h-10 cursor-default select-none items-center gap-2.5 rounded-xl px-3 text-sm font-medium outline-none [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "risk" ? "text-risk data-highlighted:bg-risk-soft" : "text-ink-2 data-highlighted:bg-surface-2 data-highlighted:text-ink",
        "data-disabled:opacity-50",
        className,
      )}
      {...p}
    />
  );
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}
