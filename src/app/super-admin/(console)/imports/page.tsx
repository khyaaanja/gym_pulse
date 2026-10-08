import { requireAdmin } from "@/lib/page-auth";
import { prisma } from "@/db/client";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";

/** Metadata only — row contents of gym imports are never shown to platform staff. */
export default async function Imports() {
  await requireAdmin("imports.view");
  const jobs = await prisma.importJob.findMany({ include: { gym: { select: { name: true } }, file: { select: { originalName: true, kind: true, sizeBytes: true, scanStatus: true, rawDeletedAt: true } } }, orderBy: { startedAt: "desc" }, take: 200 });
  return (
    <>
      <PageHeader title="Imports" description="Processing status and data quality across gyms. Row contents stay private to each gym." />
      <Card><CardBody>
        <Table>
          <thead><tr><Th>File</Th><Th>Gym</Th><Th>Type</Th><Th className="text-right">Rows</Th><Th className="text-right">Imported</Th><Th className="text-right">Quality</Th><Th>OCR</Th><Th>Scan</Th><Th>Status</Th></tr></thead>
          <tbody>{jobs.map((j) => <tr key={j.id}><Td className="font-medium">{j.file.originalName}<span className="block text-xs text-ink-3">{j.startedAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}{j.file.rawDeletedAt ? " · raw deleted" : ""}{j.errorMessage ? ` · ${j.errorMessage}` : ""}</span></Td><Td>{j.gym.name}</Td><Td>{j.recordType.replace(/_/g, " ").toLowerCase()}</Td><Td className="num text-right">{j.totalRows}</Td><Td className="num text-right">{j.importedRows}</Td><Td className="num text-right">{j.qualityScore === null ? "—" : `${j.qualityScore}%`}</Td><Td>{j.ocrUsed ? `${Math.round(j.ocrConfidence ?? 0)}%` : "—"}</Td><Td className="text-xs">{j.file.scanStatus.replace("_", " ").toLowerCase()}</Td><Td><StatusPill status={j.status} /></Td></tr>)}</tbody>
        </Table>
      </CardBody></Card>
    </>
  );
}
