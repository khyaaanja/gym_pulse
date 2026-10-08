import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "btn-3d inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background,color,box-shadow,transform,filter] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-ink shadow-[0_1px_0_rgb(255_255_255/0.22)_inset,0_10px_24px_-10px_var(--brand)] hover:shadow-[0_1px_0_rgb(255_255_255/0.22)_inset,0_14px_30px_-10px_var(--brand)] hover:brightness-110",
        secondary: "bg-surface text-ink ring-1 ring-line hover:bg-surface-2 hover:ring-ink-3/40",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        danger: "bg-risk text-white hover:brightness-110",
        ok: "bg-ok text-white hover:brightness-110",
        link: "text-brand underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-9 rounded-full px-3.5 text-sm",
        md: "h-11 rounded-full px-5 text-[15px]",
        lg: "h-14 rounded-full px-7 text-base",
        icon: "size-10 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof button> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(button({ variant, size }), className)} {...props} />;
}

export { button as buttonVariants };
