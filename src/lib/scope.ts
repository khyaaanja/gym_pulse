import type { Prisma, StaffMember } from "@/generated/prisma/client";

/**
 * Row-level visibility inside a gym. Tenant scoping (tenantDb) keeps gyms apart; this keeps trainers to the members
 * assigned to them. Every trainer-reachable query that returns member data goes through one of these — see
 * tests/trainer-scope.test.ts, which fails when a new page or route skips them.
 */
export type Viewer = { staff: Pick<StaffMember, "id" | "role"> };

const isTrainer = (v: Viewer) => v.staff.role === "TRAINER";

/** `where` fragment for Member queries (spread it in, or nest it under `member:` for related rows). */
export function memberScope(v: Viewer): Prisma.MemberWhereInput {
  return isTrainer(v) ? { trainerId: v.staff.id } : {};
}

/** `where` fragment for Booking queries: trainers see the sessions booked with them. */
export function bookingScope(v: Viewer): Prisma.BookingWhereInput {
  return isTrainer(v) ? { trainerId: v.staff.id } : {};
}

/** For a row already loaded by id: may this viewer see this member? */
export function canSeeMember(v: Viewer, member: { trainerId: string | null }) {
  return !isTrainer(v) || member.trainerId === v.staff.id;
}

/** For a booking already loaded by id. */
export function canSeeBooking(v: Viewer, booking: { trainerId: string | null }) {
  return !isTrainer(v) || booking.trainerId === v.staff.id;
}
