import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionButton } from "@/components/ui/action-button";

const NEXT: Record<string, string[]> = { DRAFT: ["REVIEW", "ARCHIVED"], REVIEW: ["PUBLISHED", "DRAFT"], PUBLISHED: ["ARCHIVED"], ARCHIVED: ["DRAFT"] };
const KEYS: Record<string, string[]> = { WEBSITE: ["hero", "features", "pricing", "testimonials", "faqs", "cta"], APP: ["onboarding", "help", "empty_states", "announcements"], MARKETPLACE: ["categories", "banners", "featured", "promotions"], LEGAL: ["terms", "privacy", "refund", "marketplace_terms"] };

export default async function Content() {
  await requireAdmin("content.manage");
  const entries = await prisma.contentEntry.findMany({ orderBy: [{ section: "asc" }, { key: "asc" }, { version: "desc" }] });
  const groups = new Map<string, typeof entries>();
  for (const e of entries) groups.set(`${e.section}/${e.key}`, [...(groups.get(`${e.section}/${e.key}`) ?? []), e]);
  return (
    <>
      <PageHeader title="Content" description="Website, app, marketplace and legal copy. Draft → Review → Published → Archived; the site shows the latest published version." actions={
        <FormDialog trigger={<Button>New version</Button>} title="New content version" description="Content is JSON (e.g. {&quot;title&quot;: &quot;…&quot;, &quot;body&quot;: &quot;…&quot;}). Legal pages use {&quot;body&quot;: &quot;…&quot;}." endpoint="/api/admin/content"
          transform="admin.content"
          fields={[
            { name: "section", label: "Section", type: "select", required: true, options: Object.keys(KEYS).map((k) => ({ value: k, label: k.toLowerCase() })) },
            { name: "key", label: "Block", type: "select", required: true, options: Object.values(KEYS).flat().map((k) => ({ value: k, label: k.replace("_", " ") })) },
            { name: "title", label: "Title", required: true },
            { name: "locale", label: "Language", type: "select", required: true, options: [{ value: "en", label: "English" }, { value: "ne", label: "नेपाली (Nepali)" }] },
            { name: "data", label: "Content (JSON, or plain text for legal pages)", type: "textarea", required: true },
          ]} />
      } />
      <div className="space-y-3">
        {[...groups.entries()].map(([k, versions]) => (
          <Card key={k}>
            <CardBody>
              <p className="font-semibold">{versions[0]!.title} <span className="text-sm font-normal text-ink-3">· {k.toLowerCase()} · {versions[0]!.locale}</span></p>
              <ul className="mt-3 space-y-2">
                {versions.slice(0, 4).map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="num w-10">v{v.version}</span><StatusPill status={v.status} />
                    <span className="min-w-0 flex-1 truncate text-ink-3">{JSON.stringify(v.data).slice(0, 110)}</span>
                    {NEXT[v.status]!.map((n) => <ActionButton key={n} size="sm" variant={n === "PUBLISHED" ? "primary" : "ghost"} method="PATCH" endpoint={`/api/admin/content/${v.id}`} body={{ status: n }}>{n === "REVIEW" ? "Send for review" : n === "PUBLISHED" ? "Publish" : n === "DRAFT" ? "To draft" : "Archive"}</ActionButton>)}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
