import Link from "next/link";
import { notFound } from "next/navigation";
import { publishedEntry, platformSetting } from "@/services/content";
import { Logo } from "@/components/brand/logo";
import { LEGAL_DOCS, type LegalKey } from "@/content/legal";
import { cn } from "@/lib/utils";

const ORDER: LegalKey[] = ["terms", "privacy", "refund", "marketplace_terms"];
const SHORT: Record<LegalKey, string> = { terms: "Terms", privacy: "Privacy", refund: "Refunds", marketplace_terms: "Marketplace" };
const isLegal = (slug: string): slug is LegalKey => (ORDER as string[]).includes(slug);

export async function generateMetadata({ params }: PageProps<"/legal/[slug]">) {
  const { slug } = await params;
  return isLegal(slug) ? { title: LEGAL_DOCS[slug].title, description: LEGAL_DOCS[slug].summary } : { title: "Legal" };
}

type Block = { kind: "h2" | "h3" | "p"; text: string } | { kind: "ul"; items: string[] };

/** The policies use a small markup (## / ### headings, "- " lists, paragraphs); older plain-text versions still read fine. */
function parse(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r/g, "").split(/\n{2,}/)) {
    let open: Block | null = null; // the paragraph or list that following lines continue
    for (const line of chunk.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith("### ") || l.startsWith("## ")) {
        blocks.push({ kind: l.startsWith("### ") ? "h3" : "h2", text: l.replace(/^#+ /, "") });
        open = null;
      } else if (l.startsWith("- ")) {
        if (open?.kind !== "ul") { open = { kind: "ul", items: [] }; blocks.push(open); }
        open.items.push(l.slice(2));
      } else if (open?.kind === "p") {
        open.text += " " + l;
      } else {
        open = { kind: "p", text: l };
        blocks.push(open);
      }
    }
  }
  return blocks;
}

const slugify = (s: string) => s.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** **bold**, email addresses and the names of the other policies become emphasis and links. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|Terms of Service|Privacy Policy|Refund Policy|Marketplace Terms)/g);
  const docLink: Record<string, string> = { "Terms of Service": "terms", "Privacy Policy": "privacy", "Refund Policy": "refund", "Marketplace Terms": "marketplace_terms" };
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
        if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(p)) return <a key={i} href={`mailto:${p}`} className="font-medium text-brand underline underline-offset-2">{p}</a>;
        if (docLink[p]) return <Link key={i} href={`/legal/${docLink[p]}`} className="text-ink underline decoration-line underline-offset-2 hover:decoration-brand">{p}</Link>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export default async function Legal({ params }: PageProps<"/legal/[slug]">) {
  const { slug } = await params;
  if (!isLegal(slug)) notFound();
  const [entry, supportEmail] = await Promise.all([
    publishedEntry<{ body: string }>("LEGAL", slug),
    platformSetting<string>("platform.supportEmail", "support@gympulse.example"),
  ]);
  const doc = LEGAL_DOCS[slug];
  const body = (entry?.data.body ?? doc.body).replaceAll("{{supportEmail}}", supportEmail);
  const blocks = parse(body);
  const toc = blocks.filter((b): b is { kind: "h2"; text: string } => b.kind === "h2");
  const updated = entry?.updatedAt ?? null;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <Link href="/" className="text-sm font-medium text-ink-2 hover:text-ink">← Back to GymPulse</Link>
      </div>

      <nav aria-label="Policies" className="mt-8 flex flex-wrap gap-1.5">
        {ORDER.map((k) => (
          <Link key={k} href={`/legal/${k}`} aria-current={k === slug ? "page" : undefined} className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium ring-1", k === slug ? "bg-ink text-mist ring-ink" : "bg-surface text-ink-2 ring-line hover:text-ink")}>
            {SHORT[k]}
          </Link>
        ))}
      </nav>

      <header className="mt-8 border-b border-line pb-6">
        <h1 className="display text-balance text-4xl font-extrabold leading-[1.05] sm:text-5xl">{entry?.title ?? doc.title}</h1>
        <p className="mt-3 max-w-[60ch] text-lg text-ink-2">{doc.summary}</p>
        {updated && <p className="mt-3 text-sm text-ink-3">Last updated {updated.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>}
      </header>

      {toc.length > 2 && (
        <nav aria-label="On this page" className="mt-6 rounded-2xl bg-surface p-5 ring-1 ring-line/70">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">On this page</p>
          <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {toc.map((h) => <li key={h.text}><a href={`#${slugify(h.text)}`} className="text-ink-2 hover:text-brand">{h.text.replace(/^\d+\.\s*/, "")}</a></li>)}
          </ol>
        </nav>
      )}

      <article className="mt-8 max-w-[68ch] text-[17px] leading-[1.7] text-ink-2">
        {blocks.map((b, i) => {
          if (b.kind === "h2") return <h2 key={i} id={slugify(b.text)} className="display mt-10 scroll-mt-6 text-2xl font-bold text-ink">{b.text}</h2>;
          if (b.kind === "h3") return <h3 key={i} className="mt-6 text-lg font-semibold text-ink">{b.text}</h3>;
          if (b.kind === "ul") return <ul key={i} className="mt-3 list-disc space-y-2 pl-5 marker:text-brand">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
          return <p key={i} className="mt-4"><Inline text={b.text} /></p>;
        })}
      </article>

      <footer className="mt-14 border-t border-line pt-6 text-sm text-ink-3">
        Questions? Write to <a href={`mailto:${supportEmail}`} className="font-medium text-brand underline underline-offset-2">{supportEmail}</a>.
      </footer>
    </main>
  );
}
