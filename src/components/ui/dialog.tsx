"use client";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** returnFocus: for dialogs opened without a DialogTrigger (e.g. from a menu item), where focus should land on close. */
export function DialogContent({ title, description, children, className, side, returnFocus }: { title: string; description?: string; children: React.ReactNode; className?: string; side?: "right" | "bottom"; returnFocus?: React.RefObject<HTMLElement | null> }) {
  const sheet = side === "right";
  return (
    <D.Portal>
      <D.Overlay className="scrim-3d fixed inset-0 z-40 bg-scrim data-[state=open]:animate-in" />
      <D.Content
        onCloseAutoFocus={returnFocus ? (e) => { e.preventDefault(); returnFocus.current?.focus(); } : undefined}
        className={cn(
          sheet ? "dialog-3d-side" : "dialog-3d",
          "fixed z-50 flex max-h-[92dvh] flex-col bg-surface shadow-lift ring-1 ring-line focus:outline-none",
          sheet
            ? "inset-y-0 right-0 w-full max-w-lg max-h-none rounded-l-3xl"
            : "inset-x-0 bottom-0 rounded-t-3xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <D.Title className="display text-lg font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-sm text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
