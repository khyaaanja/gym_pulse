import { prisma } from "./client";

/**
 * Every model with a non-null `gymId` column. tests/tenant-models.test.ts parses
 * prisma/schema.prisma and fails if this list drifts from the schema.
 */
export const TENANT_MODELS = [
  "Subscription",
  "SubscriptionInvoice",
  "Location",
  "StaffMember",
  "Invite",
  "Member",
  "MembershipPlan",
  "Membership",
  "Attendance",
  "CheckIn",
  "CheckInDevice",
  "Challenge",
  "ChallengeProgress",
  "Reward",
  "Milestone",
  "MemberReward",
  "Payment",
  "Invoice",
  "RecoveryTask",
  "RecoveryEvent",
  "PredictionReport",
  "PredictionFactor",
  "RiskAssessment",
  "RiskHistory",
  "RevenueProjection",
  "ImportedFile",
  "ImportJob",
  "ImportRow",
  "ColumnMapping",
  "DataQualityIssue",
  "VendorGym",
  "MarketplaceProduct",
  "MarketplaceOrder",
  "OrderItem",
  "Booking",
  "AutomationRun",
  "Lead",
  "GymPromotion",
  "DietPlan",
] as const;

const TENANT_SET = new Set<string>(TENANT_MODELS);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

export class TenantViolation extends Error {
  constructor(message: string) {
    super(`Tenant isolation violation: ${message}`);
  }
}

function assertData(data: unknown, gymId: string, model: string): Record<string, unknown> {
  const row = { ...(data as Record<string, unknown>) };
  if ("gym" in row) throw new TenantViolation(`${model} write must not use the gym relation; the tenant is injected`);
  if (row.gymId !== undefined && row.gymId !== gymId) {
    throw new TenantViolation(`${model} write targets gym ${String(row.gymId)} from tenant ${gymId}`);
  }
  row.gymId = gymId;
  return row;
}

/**
 * A Prisma client bound to one gym. Reads and writes on tenant models are forced into
 * that gym: `where` gains `gymId`, created rows get `gymId`, and an attempt to write a
 * different gym's id throws. Unique lookups (`findUnique`, `update`, `delete`) are scoped
 * too, so fetching another tenant's row by id returns nothing instead of leaking it.
 */
export function tenantDb(gymId: string) {
  if (!gymId) throw new TenantViolation("missing gymId");
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SET.has(model)) return query(args);
          const a = { ...(args as Record<string, unknown>) };

          if (WHERE_OPS.has(operation)) {
            a.where = { ...((a.where as Record<string, unknown>) ?? {}), gymId };
          }
          if (operation === "create") a.data = assertData(a.data, gymId, model);
          if (operation === "createMany" || operation === "createManyAndReturn") {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((r) => assertData(r, gymId, model));
          }
          if (operation === "upsert") {
            a.create = assertData(a.create, gymId, model);
            const upd = a.update as Record<string, unknown>;
            if (upd && upd.gymId !== undefined && upd.gymId !== gymId) throw new TenantViolation(`${model} upsert moves row`);
          }
          if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") {
            const d = a.data as Record<string, unknown>;
            if (d && d.gymId !== undefined && d.gymId !== gymId) throw new TenantViolation(`${model} update moves row to another gym`);
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
