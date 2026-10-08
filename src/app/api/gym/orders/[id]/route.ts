import { gymRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { fulfilOrder } from "@/services/marketplace";

export const POST = gymRoute({ permission: "marketplace.manage", feature: "marketplace" }, async (ctx, _req, params) => {
  const order = await fulfilOrder(ctx.gym.id, String(params.id));
  await audit({ actor: ctx.actor, action: "marketplace.order_fulfilled", entityType: "MarketplaceOrder", entityId: order.id, gymId: ctx.gym.id });
  return order;
});
