import Link from "next/link";
import { FileUp } from "lucide-react";
import { requireStaff } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Analyze Existing Records" };

export default async function Imports() {
  const ctx = await requireStaff("imports.view");
  const jobs = await ctx.db.importJob.findMany({ include: { file: true, predictionReport: { select: { id: true, confidence: true } } }, orderBy: { startedAt: "desc" }, take: 50 });
  const users = await prisma.user.findMany({ where: { id: { in: jobs.map((j) => j.createdById) } }, select: { id: true, name: true } });
  const who = new Map(users.map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader title="Analyze existing records" description="Upload an Excel sheet, CSV, PDF or a photo of your register. Nothing is imported until you review it." actions={ctx.can("imports.create") && ctx.flags.file_import ? <Button asChild><Link href="/app/imports/new"><FileUp /> Upload records</Link></Button> : undefined} />
      <Card><CardBody>
        {jobs.length === 0 ? (
          <EmptyState icon={<FileUp />} title="No records imported" body="Understand your member risk in minutes. Upload your attendance sheet to generate an estimated churn report." action={ctx.can("imports.create") ? <Button asChild><Link href="/app/imports/new">Analyze records</Link></Button> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>File</Th><Th>Uploaded</Th><Th className="text-right">Rows</Th><Th className="text-right">Imported</Th><Th className="text-right">Skipped</Th><Th className="text-right">Errors</Th><Th className="text-right">Quality</Th><Th>Estimate</Th><Th>Status</Th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <Td><Link href={`/app/imports/${j.id}`} className="font-medium hover:underline">{j.file.originalName}</Link><span className="block text-xs text-ink-3">{j.recordType.replace(/_/g, " ").toLowerCase()}{j.ocrUsed ? " · photo" : ""}</span></Td>
                  <Td className="whitespace-nowrap text-ink-2">{j.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}<span className="block text-xs text-ink-3">{who.get(j.createdById) ?? "—"}</span></Td>
                  <Td className="num text-right">{j.totalRows}</Td>
                  <Td className="num text-right">{j.importedRows}</Td>
                  <Td className="num text-right">{j.skippedRows}</Td>
                  <Td className="num text-right">{j.invalidRows}</Td>
                  <Td className="num text-right">{j.qualityScore === null ? "—" : `${j.qualityScore}%`}</Td>
                  <Td>{j.predictionReport ? <Link className="text-brand" href={`/app/forecast/${j.predictionReport.id}`}>{j.predictionReport.confidence === "INSUFFICIENT" ? "Not enough data" : "View"}</Link> : "—"}</Td>
                  <Td><StatusPill status={j.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody></Card>
    </>
  );
}
