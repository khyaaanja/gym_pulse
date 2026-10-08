/** Errors whose message is safe to show to end users. Anything else is reported as a generic failure. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Please sign in to continue.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do that.") => new AppError(403, "forbidden", message);
export const notFound = (message = "We couldn't find that.") => new AppError(404, "not_found", message);
export const conflict = (message: string, details?: { path: string; message: string }[]) => new AppError(409, "conflict", message, details);

// What a unique-constraint clash means to the person filling in the form. Keyed by model; fields are the columns
// in the violated constraint (minus the tenant column). Anything unlisted falls back to a generic but specific line.
const CONFLICT_NOUN: Record<string, string> = {
  Member: "member", MembershipPlan: "plan", Coupon: "coupon", Milestone: "milestone", User: "account", Gym: "gym",
  StaffMember: "team member", MarketplaceCategory: "category", PaymentProviderConfig: "payment provider",
  AutomationRule: "automation", VendorGym: "vendor", BundleItem: "bundle item", MarketplaceOrder: "order", Invoice: "invoice",
};
const CONFLICT_FIELD: Record<string, string> = {
  memberCode: "member ID", credentialUid: "card or wristband ID", name: "name", code: "code", kind: "type",
  threshold: "threshold", email: "email", phone: "mobile number", slug: "web address", providerKey: "provider",
  key: "setting", number: "number", productId: "item", vendorId: "vendor",
};
const CONFLICT_SPECIAL: Record<string, string> = {
  "StaffMember:userId": "This person is already on your team.",
  "Milestone:kind,threshold": "There's already a milestone of this type at this threshold. Change the threshold or edit the existing one.",
  "Coupon:code": "A coupon with this code already exists. Choose a different code.",
  "MembershipPlan:name": "A plan with this name already exists. Choose a different name.",
  "Member:memberCode": "Another member already has this member ID.",
  "Member:credentialUid": "Another member already uses this card or wristband ID.",
  "User:email": "An account with this email already exists.",
  "User:phone": "An account with this mobile number already exists.",
  "Membership:renewedFromId": "This membership was just renewed by another payment. Refresh the page to see it before recording another.",
};

/** Turns a database unique-constraint error (Prisma P2002) into a message naming what clashed, with field details. */
export function describeUniqueViolation(err: { meta?: unknown }) {
  const meta = (err.meta ?? {}) as { modelName?: string; target?: string | string[]; driverAdapterError?: { cause?: { table?: string; constraint?: { index?: string; fields?: string[] } } } };
  const cause = meta.driverAdapterError?.cause;
  const model = meta.modelName ?? cause?.table ?? "";
  let fields: string[] = Array.isArray(meta.target) ? meta.target : cause?.constraint?.fields ?? [];
  const index = typeof meta.target === "string" ? meta.target : cause?.constraint?.index;
  if (!fields.length && index) fields = index.replace(new RegExp(`^${model}_`), "").replace(/_key$/, "").split("_");
  fields = fields.map((f) => f.replace(/"/g, "")).filter((f) => f && f !== "gymId" && f !== "scopeId");
  const special = CONFLICT_SPECIAL[`${model}:${fields.join(",")}`];
  const noun = CONFLICT_NOUN[model] ?? (model ? model.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : "record");
  const labels = fields.map((f) => CONFLICT_FIELD[f] ?? f.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
  const message = special ?? (labels.length ? `A ${noun} with this ${labels.join(" and ")} already exists.` : `This ${noun} already exists.`);
  return conflict(message, fields.map((path) => ({ path, message })));
}
export const tooMany = (message = "Too many attempts. Please wait a moment and try again.") =>
  new AppError(429, "rate_limited", message);
export const featureDisabled = (feature: string) =>
  new AppError(403, "feature_disabled", `${feature} isn't available on your plan.`);
export const limitReached = (message: string) => new AppError(402, "limit_reached", message);
