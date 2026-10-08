import { prisma } from "@/db/client";
import { tenantDb } from "@/db/tenant";
import { badRequest, notFound } from "@/lib/errors";

export async function activeLocations(gymId: string) {
  return tenantDb(gymId).location.findMany({ where: { active: true }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }], select: { id: true, name: true, isPrimary: true } });
}

/**
 * The branch a check-in belongs to: the one asked for (it must be an active branch of this gym),
 * otherwise the primary branch, so every visit is attributed somewhere.
 */
export async function resolveLocation(gymId: string, locationId?: string | null) {
  const db = tenantDb(gymId);
  if (locationId) {
    const l = await db.location.findFirst({ where: { id: locationId, active: true } });
    if (!l) throw badRequest("Choose one of this gym's open branches.");
    return l.id;
  }
  return (await db.location.findFirst({ where: { isPrimary: true, active: true } }))?.id ?? null;
}

export async function createLocation(gymId: string, input: { name: string; address?: string | null }, multiLocation: boolean) {
  const db = tenantDb(gymId);
  const count = await db.location.count({ where: { active: true } });
  if (count >= 1 && !multiLocation) throw badRequest("More than one branch isn't available on your plan.");
  if (await db.location.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) throw badRequest("A branch with that name already exists.");
  return db.location.create({ data: { gymId, name: input.name, address: input.address ?? null, isPrimary: count === 0 } });
}

/** Rename, move, close/reopen or make primary. There is always exactly one open primary branch. */
export async function updateLocation(gymId: string, id: string, input: { name?: string; address?: string | null; active?: boolean; isPrimary?: boolean }, multiLocation: boolean) {
  const db = tenantDb(gymId);
  const before = await db.location.findUnique({ where: { id } });
  if (!before) throw notFound();
  if (input.active === false && before.isPrimary) throw badRequest("Make another branch the main one before closing this one.");
  if (input.isPrimary === false) throw badRequest("Choose which branch should be the main one instead.");
  if (input.active === true && !before.active && !multiLocation && (await db.location.count({ where: { active: true } })) >= 1) throw badRequest("More than one branch isn't available on your plan.");
  if (input.name && input.name.toLowerCase() !== before.name.toLowerCase() && (await db.location.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, id: { not: id } } }))) throw badRequest("A branch with that name already exists.");
  const after = await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      if (!before.active && input.active !== true) throw badRequest("Reopen this branch before making it the main one.");
      await tx.location.updateMany({ where: { gymId, isPrimary: true }, data: { isPrimary: false } });
    }
    return tx.location.update({ where: { id: before.id }, data: { name: input.name, address: input.address, active: input.active, isPrimary: input.isPrimary } });
  });
  return { before, after };
}

/** Visits per branch in [from, toEnd). Visits with no branch recorded are reported as "Not recorded". */
export async function visitsByLocation(gymId: string, from: Date, toEnd: Date) {
  const db = tenantDb(gymId);
  const [groups, locations] = await Promise.all([
    db.attendance.groupBy({ by: ["locationId"], where: { localDate: { gte: from, lt: toEnd } }, _count: { _all: true } }),
    db.location.findMany({ select: { id: true, name: true, active: true } }),
  ]);
  return groups
    .map((g) => ({ id: g.locationId, name: locations.find((l) => l.id === g.locationId)?.name ?? "Not recorded", visits: g._count._all }))
    .sort((a, b) => b.visits - a.visits);
}
