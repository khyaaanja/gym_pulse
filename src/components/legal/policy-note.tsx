import Link from "next/link";
import { cn } from "@/lib/utils";

const DOCS = {
  terms: ["/legal/terms", "Terms of Service"],
  privacy: ["/legal/privacy", "Privacy Policy"],
  refund: ["/legal/refund", "Refund Policy"],
  marketplace: ["/legal/marketplace_terms", "Marketplace Terms"],
} as const;

const NOTES = {
  signup: { lead: "By creating your gym you agree to the", docs: ["terms", "privacy"] },
  invite: { lead: "By creating your account you agree to the", docs: ["terms", "privacy"] },
  renew: { lead: "Payments are covered by the", docs: ["refund"] },
  shop: { lead: "Purchases are covered by the", docs: ["marketplace", "refund"] },
} as const;

/** One line under a submit button naming the policies it agrees to. Links open in a new tab so forms and carts survive. */
export function PolicyNote({ kind, className }: { kind: keyof typeof NOTES; className?: string }) {
  const note = NOTES[kind];
  return (
    <p className={cn("text-center text-xs text-ink-3", className)}>
      {note.lead}{" "}
      {note.docs.map((d, i) => (
        <span key={d}>
          {i > 0 && " and "}
          <Link href={DOCS[d][0]} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">{DOCS[d][1]}</Link>
        </span>
      ))}
      .
    </p>
  );
}
