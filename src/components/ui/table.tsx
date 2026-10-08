import { cn } from "@/lib/utils";

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative -mx-5 overflow-x-auto px-5 focus-visible:outline-offset-[-2px]" tabIndex={0}>
      <table className={cn("w-full min-w-[560px] border-separate border-spacing-0 text-sm", className)} {...p} />
    </div>
  );
}
export const Th = ({ className, children, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn("border-b border-line px-3 pb-2.5 text-left text-xs font-medium text-ink-3 first:pl-0 last:pr-0", className)} {...p}>
    {children ?? <span className="sr-only">Actions</span>}
  </th>
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("border-b border-line/70 px-3 py-3 align-middle first:pl-0 last:pr-0", className)} {...p} />
);
