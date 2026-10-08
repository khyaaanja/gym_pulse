import { requireStaff } from "@/lib/page-auth";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { bookingScope } from "@/lib/scope";

export const metadata = { title: "Bookings" };

export default async function Bookings() {
  const ctx = await requireStaff("bookings.manage");
  const [bookings, trainers] = await Promise.all([
    ctx.db.booking.findMany({ where: bookingScope(ctx), include: { member: { select: { fullName: true, phone: true } }, trainer: { include: { user: { select: { name: true } } } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 }),
    ctx.db.staffMember.findMany({ where: { role: "TRAINER", active: true }, include: { user: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Bookings" description={ctx.staff.role === "TRAINER" ? "Sessions members bought with you." : "PT packs, classes and services members have bought."} />
      <Card><CardBody>
        {bookings.length === 0 ? <EmptyState title="No bookings yet" body="When members buy a training pack or class, it shows up here to schedule." /> : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Booking</Th><Th>Trainer</Th><Th>Sessions</Th><Th>Next session</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <Td className="font-medium">{b.member.fullName}{b.member.phone && <span className="block text-xs text-ink-3"><a href={`tel:${b.member.phone}`}>{b.member.phone}</a></span>}</Td>
                  <Td>{b.title}</Td>
                  <Td className="text-ink-2">{b.trainer?.user.name ?? "Unassigned"}</Td>
                  <Td className="num">{b.sessionsUsed}/{b.sessionsTotal}</Td>
                  <Td className="whitespace-nowrap">{b.scheduledAt ? b.scheduledAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.gym.timezone }) : "—"}</Td>
                  <Td><StatusPill status={b.status} /></Td>
                  <Td className="text-right">
                    <FormDialog trigger={<Button size="sm" variant="ghost">Update</Button>} title={b.title} endpoint={`/api/gym/bookings/${b.id}`} method="PATCH" fields={[
                      { name: "status", label: "Status", type: "select", required: true, defaultValue: b.status, options: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() })) },
                      { name: "scheduledAt", label: "Next session", type: "datetime" },
                      { name: "sessionsUsed", label: "Sessions used", type: "number", defaultValue: b.sessionsUsed },
                      ...(ctx.staff.role !== "TRAINER" ? [{ name: "trainerId", label: "Trainer", type: "select" as const, defaultValue: b.trainerId, options: trainers.map((t) => ({ value: t.id, label: t.user.name })) }] : []),
                      { name: "notes", label: "Notes", type: "textarea", defaultValue: b.notes },
                    ]} transform="gym.booking" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody></Card>
    </>
  );
}
