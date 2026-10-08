import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./helpers/route")).nextHeaders);
import { prisma } from "@/db/client";
import { expireUnpaidOrders, bundleAvailability } from "@/services/marketplace";
import { errCode, json, params, req, signInMember, signInStaff, signOut } from "./helpers/route";
import { ensureSandboxProvider, makeCoupon, makeGym, makeMember } from "./helpers/fixtures";
import { makeCategory, makeListing, marketplaceBalance, paidEvent, sandboxWebhook, sumLedger } from "./helpers/money";

const { POST: createProduct } = await import("@/app/api/gym/products/route");
const { PATCH: patchProduct } = await import("@/app/api/gym/products/[id]/route");
const { POST: createBundleRoute } = await import("@/app/api/gym/products/bundles/route");
const { POST: placeOrderRoute, GET: listOrders } = await import("@/app/api/me/orders/route");
const { POST: payOrder } = await import("@/app/api/me/orders/[id]/pay/route");
const { POST: fulfil } = await import("@/app/api/gym/orders/[id]/route");
const { GET: listBookings } = await import("@/app/api/gym/bookings/route");
const { PATCH: patchBooking } = await import("@/app/api/gym/bookings/[id]/route");

beforeAll(async () => {
  process.env.ENABLE_TEST_GATEWAY = "true";
  await ensureSandboxProvider();
});
beforeEach(() => signOut());

const unwrap = <T>(b: unknown) => ((b as { data?: T }).data ?? b) as T;
const inv = async (id: string) => (await prisma.marketplaceProduct.findUniqueOrThrow({ where: { id } })).inventory;
const order = (items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) => placeOrderRoute(req("/api/me/orders", { body: { items, ...extra } }), params());
const orderId = async (res: Response) => unwrap<{ orderId: string }>(await json(res)).orderId;

async function buyer() {
  const { gym } = await makeGym();
  const member = await makeMember(gym.id);
  await signInMember(gym.id, member.id);
  return { gym, member };
}
async function payFully(id: string) {
  const res = await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "sandbox" } }), params({ id }));
  expect(res.status).toBe(200);
  const p = await prisma.payment.findFirstOrThrow({ where: { orderId: id }, orderBy: { createdAt: "desc" } });
  expect((await sandboxWebhook(paidEvent(p))).status).toBe(200);
  return p;
}

describe("orders reserve and release stock", () => {
  it("placing an order reserves stock and prices lines from the DB, ignoring client price/total", async () => {
    const { gym, member } = await buyer();
    const p = await makeListing(gym.id, { price: 50_000, inventory: 10 });
    const res = await order([{ productId: p.id, quantity: 3, pricePaisa: 1, unitPricePaisa: 1 } as never], { totalPaisa: 1, total: 1, subtotalPaisa: 1, discountPaisa: 999_999 });
    expect(res.status).toBe(200);
    const o = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id: await orderId(res) }, include: { items: true } });
    expect(o).toMatchObject({ memberId: member.id, gymId: gym.id, status: "PENDING_PAYMENT", subtotalPaisa: 150_000, discountPaisa: 0, totalPaisa: 150_000 });
    expect(o.items[0]).toMatchObject({ unitPricePaisa: 50_000, quantity: 3 });
    expect(await inv(p.id)).toBe(7);
  });

  it("an order for more than the stock is refused (409) and stock is untouched", async () => {
    const { gym, member } = await buyer();
    const p = await makeListing(gym.id, { inventory: 2 });
    const res = await order([{ productId: p.id, quantity: 3 }]);
    expect(res.status).toBe(409);
    expect(await inv(p.id)).toBe(2);
    expect(await prisma.marketplaceOrder.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("a multi-line order that fails on its second line rolls the first line's reservation back", async () => {
    const { gym } = await buyer();
    const a = await makeListing(gym.id, { inventory: 5 });
    const b = await makeListing(gym.id, { inventory: 1 });
    const res = await order([{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 2 }]);
    expect(res.status).toBe(409);
    expect(await inv(a.id)).toBe(5);
    expect(await inv(b.id)).toBe(1);
  });

  it("cannot oversell under concurrency: 5 buyers for 2 units yields exactly 2 orders and stock 0", async () => {
    const { gym, member } = await buyer();
    const p = await makeListing(gym.id, { inventory: 2 });
    const res = await Promise.all(Array.from({ length: 5 }, () => order([{ productId: p.id, quantity: 1 }])));
    expect(res.map((r) => r.status).sort()).toEqual([200, 200, 409, 409, 409]);
    expect(await inv(p.id)).toBe(0);
    expect(await prisma.marketplaceOrder.count({ where: { memberId: member.id } })).toBe(2);
    expect(await prisma.orderItem.aggregate({ where: { productId: p.id }, _sum: { quantity: true } }).then((r) => r._sum.quantity)).toBe(2);
  });

  it("unlimited-stock (null inventory) listings stay null", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id, { inventory: null });
    expect((await order([{ productId: p.id, quantity: 20 }])).status).toBe(200);
    expect(await inv(p.id)).toBeNull();
  });

  it("invalid quantities, empty carts, draft/archived and foreign-gym listings are refused", async () => {
    const { gym } = await buyer();
    const other = await makeGym();
    const foreign = await makeListing(other.gym.id);
    const draft = await makeListing(gym.id);
    await prisma.marketplaceProduct.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    const ok = await makeListing(gym.id);
    expect((await order([])).status).toBe(400);
    expect((await order([{ productId: ok.id, quantity: 0 }])).status).toBe(400);
    expect((await order([{ productId: ok.id, quantity: 21 }])).status).toBe(400);
    expect((await order([{ productId: foreign.id, quantity: 1 }])).status).toBe(400);
    expect((await order([{ productId: draft.id, quantity: 1 }])).status).toBe(400);
    expect(await inv(ok.id)).toBe(10);
    expect(await inv(foreign.id)).toBe(10);
  });

  it("anonymous cannot order (401)", async () => {
    expect((await order([{ productId: "x", quantity: 1 }])).status).toBe(401);
  });

  it("a failed payment webhook cancels the order and returns the exact stock", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id, { inventory: 5 });
    const id = await orderId(await order([{ productId: p.id, quantity: 2 }]));
    expect(await inv(p.id)).toBe(3);
    await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "sandbox" } }), params({ id }));
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: id } });
    await sandboxWebhook(paidEvent(pay, "FAILED"));
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect(await inv(p.id)).toBe(5);
    expect(await prisma.ledgerEntry.count({ where: { orderId: id } })).toBe(0);
  });

  it("a replayed failure webhook releases stock only once", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id, { inventory: 5 });
    const id = await orderId(await order([{ productId: p.id, quantity: 2 }]));
    await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "sandbox" } }), params({ id }));
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: id } });
    const e = paidEvent(pay, "FAILED");
    await sandboxWebhook(e);
    await sandboxWebhook(e);
    await sandboxWebhook(paidEvent(pay, "FAILED"));
    expect(await inv(p.id)).toBe(5);
  });

  it("unpaid orders older than 30 minutes expire and release stock; fresh and paid ones are untouched", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id, { inventory: 10 });
    const stale = await orderId(await order([{ productId: p.id, quantity: 2 }]));
    const fresh = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    const paid = await orderId(await order([{ productId: p.id, quantity: 3 }]));
    await payFully(paid);
    await prisma.marketplaceOrder.updateMany({ where: { id: { in: [stale, paid] } }, data: { placedAt: new Date(Date.now() - 31 * 60_000) } });
    expect(await inv(p.id)).toBe(4);
    await expireUnpaidOrders();
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id: stale } })).status).toBe("CANCELLED");
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id: fresh } })).status).toBe("PENDING_PAYMENT");
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id: paid } })).status).toBe("PAID");
    expect(await inv(p.id)).toBe(6);
    await expireUnpaidOrders();
    expect(await inv(p.id)).toBe(6);
  });

  it("a cancelled order releases its coupon reservation", async () => {
    const { gym, member } = await buyer();
    const p = await makeListing(gym.id);
    const c = await makeCoupon(gym.id, { perMemberLimit: 1 });
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }], { couponCode: c.code }));
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id, memberId: member.id } })).toBe(1);
    await prisma.marketplaceOrder.update({ where: { id }, data: { placedAt: new Date(Date.now() - 31 * 60_000) } });
    await expireUnpaidOrders();
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    expect((await order([{ productId: p.id, quantity: 1 }], { couponCode: c.code })).status).toBe(200);
  });

  it("coupon discount applies to the order total (50% off) and a second order with a limit-1 coupon is refused", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id, { price: 40_000 });
    const c = await makeCoupon(gym.id, { perMemberLimit: 1 });
    const res = await order([{ productId: p.id, quantity: 2 }], { couponCode: c.code });
    expect(unwrap<{ totalPaisa: number }>(await json(res)).totalPaisa).toBe(40_000);
    const again = await order([{ productId: p.id, quantity: 1 }], { couponCode: c.code });
    expect(again.status).toBe(400);
    expect(await inv(p.id)).toBe(8);
  });
});

describe("paying and fulfilling an order", () => {
  it("only the owner member can start checkout; another member gets 404", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id);
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    signOut();
    const other = await makeMember(gym.id);
    await signInMember(gym.id, other.id);
    const res = await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "sandbox" } }), params({ id }));
    expect(res.status).toBe(404);
    expect(await prisma.payment.count({ where: { orderId: id } })).toBe(0);
  });

  it("the payment amount is the server-side order total; a webhook with a different amount is rejected", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id, { price: 50_000 });
    const id = await orderId(await order([{ productId: p.id, quantity: 2 }]));
    await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "sandbox", amountPaisa: 1 } }), params({ id }));
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: id } });
    expect(pay.amountPaisa).toBe(100_000);
    await sandboxWebhook(paidEvent({ reference: pay.reference, amountPaisa: 1 }));
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_PAYMENT");
    expect(await prisma.ledgerEntry.count({ where: { orderId: id } })).toBe(0);
  });

  it("paying marks the order PAID, books a balanced ledger once, even if the webhook is replayed", async () => {
    const { gym } = await buyer();
    await prisma.commissionRule.create({ data: { name: "t", scope: "GYM", gymId: gym.id, platformBps: 1000, gymBps: 9000, vendorBps: 0 } });
    const p = await makeListing(gym.id, { price: 33_333 });
    const id = await orderId(await order([{ productId: p.id, quantity: 3 }]));
    const pay = await payFully(id);
    await sandboxWebhook(paidEvent(pay));
    await sandboxWebhook(paidEvent(pay));
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
    const bal = await marketplaceBalance(id);
    expect(bal.gross).toBe(99_999);
    expect(bal.parts).toBe(bal.gross);
    expect(bal.fee).toBe(10_000); // 10% of 99_999 rounded
    expect(await prisma.ledgerEntry.count({ where: { orderId: id, account: "MARKETPLACE_GROSS" } })).toBe(1);
    expect(await prisma.invoice.count({ where: { paymentId: pay.id } })).toBe(1);
  });

  it("only paid orders can be marked fulfilled (400 otherwise); fulfilling needs marketplace.manage", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id);
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    signOut();
    await signInStaff(gym.id, "OWNER");
    expect((await fulfil(req(`/api/gym/orders/${id}`, { method: "POST", body: {} }), params({ id }))).status).toBe(400);
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_PAYMENT");
    signOut();
    const m = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } });
    await signInMember(gym.id, m.memberId);
    await payFully(id);
    signOut();
    await signInStaff(gym.id, "STAFF");
    expect((await fulfil(req(`/api/gym/orders/${id}`, { method: "POST", body: {} }), params({ id }))).status).toBe(403);
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
    signOut();
    await signInStaff(gym.id, "MANAGER");
    expect((await fulfil(req(`/api/gym/orders/${id}`, { method: "POST", body: {} }), params({ id }))).status).toBe(200);
    const done = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } });
    expect(done.status).toBe("FULFILLED");
    expect(done.fulfilledAt).not.toBeNull();
  });

  it("another gym's staff can't fulfil this gym's order (404) and it stays PAID", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id);
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    await payFully(id);
    signOut();
    const other = await makeGym();
    await signInStaff(other.gym.id, "OWNER");
    expect((await fulfil(req(`/api/gym/orders/${id}`, { method: "POST", body: {} }), params({ id }))).status).toBe(404);
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
  });

  it("a member only sees their own orders", async () => {
    const { gym, member } = await buyer();
    const p = await makeListing(gym.id);
    await order([{ productId: p.id, quantity: 1 }]);
    signOut();
    const other = await makeMember(gym.id);
    await signInMember(gym.id, other.id);
    expect(unwrap<unknown[]>(await json(await listOrders(req("/api/me/orders"), params())))).toHaveLength(0);
    signOut();
    await signInMember(gym.id, member.id);
    expect(unwrap<unknown[]>(await json(await listOrders(req("/api/me/orders"), params())))).toHaveLength(1);
  });
});

describe("vendor commission", () => {
  async function vendorSetup(bps: { platformBps: number; gymBps: number; vendorBps: number }) {
    const { gym, member } = await buyer();
    const vendor = await prisma.marketplaceVendor.create({ data: { name: "Vendor", email: `v${Date.now()}${Math.random()}@example.test`, status: "APPROVED" } });
    await prisma.commissionRule.create({ data: { name: "vendor rule", scope: "VENDOR", vendorId: vendor.id, ...bps } });
    return { gym, member, vendor };
  }

  it("splits the paid amount into platform / gym / vendor from the vendor rule; ledger balances to the paisa", async () => {
    const { gym, vendor } = await vendorSetup({ platformBps: 1000, gymBps: 2000, vendorBps: 7000 });
    const p = await makeListing(gym.id, { price: 99_999, vendorId: vendor.id });
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    const o = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } });
    expect(o.platformFeePaisa).toBe(10_000);
    expect(o.vendorSharePaisa).toBe(69_999);
    expect(o.platformFeePaisa + o.gymSharePaisa + o.vendorSharePaisa).toBe(o.totalPaisa);
    await payFully(id);
    const bal = await marketplaceBalance(id);
    expect(bal).toMatchObject({ gross: 99_999, fee: 10_000, vendor: 69_999, gym: 20_000 });
    expect(bal.parts).toBe(bal.gross);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { orderId: id, account: "VENDOR_PAYABLE" } });
    expect(entry.vendorId).toBe(vendor.id);
  });

  it("a gym's own listing folds the vendor share into the gym share", async () => {
    const { gym } = await buyer();
    await prisma.commissionRule.create({ data: { name: "gym rule", scope: "GYM", gymId: gym.id, platformBps: 1500, gymBps: 5000, vendorBps: 3500 } });
    const p = await makeListing(gym.id, { price: 100_000 });
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    const o = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } });
    expect(o).toMatchObject({ platformFeePaisa: 15_000, vendorSharePaisa: 0, gymSharePaisa: 85_000 });
    await payFully(id);
    expect(await sumLedger({ orderId: id }, "VENDOR_PAYABLE")).toBe(0);
    expect((await marketplaceBalance(id)).parts).toBe(100_000);
  });

  it("a coupon discount is shared proportionally: commission is on the discounted amount and the ledger still balances", async () => {
    const { gym, vendor } = await vendorSetup({ platformBps: 1000, gymBps: 2000, vendorBps: 7000 });
    const p = await makeListing(gym.id, { price: 70_001, vendorId: vendor.id });
    const own = await makeListing(gym.id, { price: 30_003 });
    const c = await makeCoupon(gym.id);
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }, { productId: own.id, quantity: 1 }], { couponCode: c.code }));
    const o = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } });
    expect(o.discountPaisa).toBe(Math.round(100_004 / 2));
    expect(o.totalPaisa).toBe(100_004 - o.discountPaisa);
    expect(o.platformFeePaisa + o.gymSharePaisa + o.vendorSharePaisa).toBe(o.totalPaisa);
    await payFully(id);
    const bal = await marketplaceBalance(id);
    expect(bal.gross).toBe(o.totalPaisa);
    expect(bal.parts).toBe(bal.gross);
    expect(bal.vendor).toBe(o.vendorSharePaisa);
  });

  it("two vendors on one order get separate payable lines that sum to the order's vendor share", async () => {
    const { gym } = await buyer();
    const mk = async (bps: number) => {
      const v = await prisma.marketplaceVendor.create({ data: { name: "V", email: `v${Date.now()}${Math.random()}@example.test`, status: "APPROVED" } });
      await prisma.commissionRule.create({ data: { name: "vr", scope: "VENDOR", vendorId: v.id, platformBps: 1000, gymBps: 10_000 - 1000 - bps, vendorBps: bps } });
      return v;
    };
    const v1 = await mk(6000), v2 = await mk(5000);
    const a = await makeListing(gym.id, { price: 33_333, vendorId: v1.id });
    const b = await makeListing(gym.id, { price: 66_667, vendorId: v2.id });
    const id = await orderId(await order([{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }]));
    await payFully(id);
    const lines = await prisma.ledgerEntry.findMany({ where: { orderId: id, account: "VENDOR_PAYABLE" } });
    expect(lines.map((l) => l.vendorId).sort()).toEqual([v1.id, v2.id].sort());
    const o = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } });
    expect(lines.reduce((s, l) => s + l.amountPaisa, 0)).toBe(o.vendorSharePaisa);
    const bal = await marketplaceBalance(id);
    expect(bal.parts).toBe(bal.gross);
  });

  it("vendor rule outranks the gym rule (most specific wins)", async () => {
    const { gym, vendor } = await vendorSetup({ platformBps: 500, gymBps: 4500, vendorBps: 5000 });
    await prisma.commissionRule.create({ data: { name: "gym rule", scope: "GYM", gymId: gym.id, platformBps: 3000, gymBps: 7000, vendorBps: 0, priority: 99 } });
    const p = await makeListing(gym.id, { price: 100_000, vendorId: vendor.id });
    const o = await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id: await orderId(await order([{ productId: p.id, quantity: 1 }])) } });
    expect(o.platformFeePaisa).toBe(5000);
    expect(o.vendorSharePaisa).toBe(50_000);
  });
});

describe("gym product and bundle routes", () => {
  async function owner() {
    const { gym } = await makeGym();
    await signInStaff(gym.id, "OWNER");
    return gym;
  }
  const mkProduct = (body: Record<string, unknown>) => createProduct(req("/api/gym/products", { body }), params());
  const mkBundle = (body: Record<string, unknown>) => createBundleRoute(req("/api/gym/products/bundles", { body }), params());

  it("creating a product converts rupees to paisa, takes gym from the session, and ignores a client gymId/price in paisa", async () => {
    const gym = await owner();
    const other = await makeGym();
    const cat = await makeCategory("PRODUCT");
    const res = await mkProduct({ name: "Shaker", categoryId: cat.id, priceRupees: 499.5, inventory: 7, status: "ACTIVE", gymId: other.gym.id, pricePaisa: 1, vendorId: "x" });
    expect(res.status).toBe(200);
    const p = await prisma.marketplaceProduct.findFirstOrThrow({ where: { name: "Shaker", gymId: gym.id } });
    expect(p).toMatchObject({ pricePaisa: 49_950, inventory: 7, vendorId: null, isBundle: false });
    expect(await prisma.marketplaceProduct.count({ where: { gymId: other.gym.id } })).toBe(0);
  });

  it("service listings never carry stock; zero/negative price is rejected", async () => {
    await owner();
    const svc = await makeCategory("SERVICE");
    const res = await mkProduct({ name: "PT session", categoryId: svc.id, priceRupees: 800, inventory: 50, sessionCount: 5, status: "ACTIVE" });
    expect(res.status).toBe(200);
    expect((await prisma.marketplaceProduct.findFirstOrThrow({ where: { name: "PT session" } })).inventory).toBeNull();
    expect((await mkProduct({ name: "Free", categoryId: svc.id, priceRupees: 0 })).status).toBe(400);
  });

  it("STAFF and TRAINER can't create products (403)", async () => {
    const { gym } = await makeGym();
    const cat = await makeCategory();
    for (const role of ["STAFF", "TRAINER"] as const) {
      signOut();
      await signInStaff(gym.id, role);
      expect((await mkProduct({ name: "Nope", categoryId: cat.id, priceRupees: 10 })).status).toBe(403);
    }
    expect(await prisma.marketplaceProduct.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("a gym can't edit another gym's product (404) and can't change a vendor-less field via body gymId", async () => {
    const a = await makeGym();
    const p = await makeListing(a.gym.id);
    const b = await makeGym();
    await signInStaff(b.gym.id, "OWNER");
    const res = await patchProduct(req(`/api/gym/products/${p.id}`, { method: "PATCH", body: { name: "Hijack", priceRupees: 1 } }), params({ id: p.id }));
    expect(res.status).toBe(404);
    expect((await prisma.marketplaceProduct.findUniqueOrThrow({ where: { id: p.id } })).pricePaisa).toBe(50_000);
  });

  it("bundle: price must be below the sum of its items; stock and compare-at are derived, client values ignored", async () => {
    const gym = await owner();
    const a = await makeListing(gym.id, { price: 50_000, inventory: 10 });
    const b = await makeListing(gym.id, { price: 30_000, inventory: 4 });
    const cat = await makeCategory("PRODUCT");
    const items = [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 2 }];
    expect((await mkBundle({ name: "Too dear", categoryId: cat.id, priceRupees: 1100, items })).status).toBe(400); // separately = 1100
    expect((await mkBundle({ name: "Equal", categoryId: cat.id, priceRupees: 1100, items })).status).toBe(400);
    expect(await prisma.marketplaceProduct.count({ where: { gymId: gym.id, isBundle: true } })).toBe(0);
    const res = await mkBundle({ name: "Starter", categoryId: cat.id, priceRupees: 900, items, inventory: 9999, compareAtPaisa: 1, compareAtRupees: 1, pricePaisa: 1 });
    expect(res.status).toBe(200);
    const bundle = await prisma.marketplaceProduct.findFirstOrThrow({ where: { name: "Starter" }, include: { bundleItems: { include: { product: true } } } });
    expect(bundle).toMatchObject({ pricePaisa: 90_000, compareAtPaisa: 110_000, inventory: null, isBundle: true });
    expect(bundleAvailability(bundle.bundleItems)).toBe(2); // min(10/1, 4/2)
  });

  it("bundle validation: 1 item, duplicates, vendor/foreign/other-bundle items are refused", async () => {
    const gym = await owner();
    const other = await makeGym();
    const a = await makeListing(gym.id), b = await makeListing(gym.id), foreign = await makeListing(other.gym.id);
    const cat = await makeCategory();
    const body = (items: unknown) => ({ name: "Bad", categoryId: cat.id, priceRupees: 1, items });
    expect((await mkBundle(body([{ productId: a.id, quantity: 1 }]))).status).toBe(400);
    expect((await mkBundle(body([{ productId: a.id, quantity: 1 }, { productId: a.id, quantity: 1 }]))).status).toBe(400);
    expect((await mkBundle(body([{ productId: a.id, quantity: 1 }, { productId: foreign.id, quantity: 1 }]))).status).toBe(400);
    expect((await mkBundle(body([{ productId: a.id, quantity: 11 }, { productId: b.id, quantity: 1 }]))).status).toBe(400);
    expect(await prisma.marketplaceProduct.count({ where: { gymId: gym.id, isBundle: true } })).toBe(0);
  });

  it("a bundle's stock can't be set by PATCH, and its price can't be raised to the separate price", async () => {
    const gym = await owner();
    const a = await makeListing(gym.id, { price: 50_000 }), b = await makeListing(gym.id, { price: 50_000 });
    const cat = await makeCategory();
    await mkBundle({ name: "Duo", categoryId: cat.id, priceRupees: 900, items: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }] });
    const bundle = await prisma.marketplaceProduct.findFirstOrThrow({ where: { name: "Duo" } });
    const patch = (body: Record<string, unknown>) => patchProduct(req(`/api/gym/products/${bundle.id}`, { method: "PATCH", body }), params({ id: bundle.id }));
    expect((await patch({ inventory: 500 })).status).toBe(400);
    expect((await patch({ priceRupees: 1000 })).status).toBe(400);
    expect((await patch({ priceRupees: 950 })).status).toBe(200);
    const after = await prisma.marketplaceProduct.findUniqueOrThrow({ where: { id: bundle.id } });
    expect(after).toMatchObject({ pricePaisa: 95_000, inventory: null });
  });

  it("ordering a bundle reserves each component's stock; cancelling gives back exactly that; bundle sells out with its scarcest item", async () => {
    const gym = await owner();
    const a = await makeListing(gym.id, { price: 50_000, inventory: 10 });
    const b = await makeListing(gym.id, { price: 30_000, inventory: 4 });
    const cat = await makeCategory();
    await mkBundle({ name: "Combo", categoryId: cat.id, priceRupees: 900, items: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 2 }] });
    const bundle = await prisma.marketplaceProduct.findFirstOrThrow({ where: { name: "Combo" } });
    signOut();
    const member = await makeMember(gym.id);
    await signInMember(gym.id, member.id);
    const id = await orderId(await order([{ productId: bundle.id, quantity: 2 }]));
    expect(await inv(a.id)).toBe(8);
    expect(await inv(b.id)).toBe(0);
    expect((await prisma.marketplaceOrder.findUniqueOrThrow({ where: { id } })).totalPaisa).toBe(180_000);
    expect((await order([{ productId: bundle.id, quantity: 1 }])).status).toBe(409);
    expect(await inv(a.id)).toBe(8);
    await prisma.marketplaceOrder.update({ where: { id }, data: { placedAt: new Date(Date.now() - 31 * 60_000) } });
    await expireUnpaidOrders();
    expect(await inv(a.id)).toBe(10);
    expect(await inv(b.id)).toBe(4);
  });

  it("concurrent bundle orders can't oversell a component", async () => {
    const gym = await owner();
    const a = await makeListing(gym.id, { price: 50_000, inventory: 100 });
    const b = await makeListing(gym.id, { price: 30_000, inventory: 3 });
    const cat = await makeCategory();
    await mkBundle({ name: "Race", categoryId: cat.id, priceRupees: 700, items: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }] });
    const bundle = await prisma.marketplaceProduct.findFirstOrThrow({ where: { name: "Race" } });
    signOut();
    const member = await makeMember(gym.id);
    await signInMember(gym.id, member.id);
    const res = await Promise.all(Array.from({ length: 6 }, () => order([{ productId: bundle.id, quantity: 1 }])));
    expect(res.filter((r) => r.status === 200)).toHaveLength(3);
    expect(await inv(b.id)).toBe(0);
    expect(await inv(a.id)).toBe(97);
  });
});

describe("service bookings", () => {
  async function paidService(sessionCount: number, quantity: number, trainerId?: string) {
    const { gym, member } = await buyer();
    const p = await makeListing(gym.id, { kind: "SERVICE", price: 80_000, sessionCount, trainerId });
    const id = await orderId(await order([{ productId: p.id, quantity }]));
    expect(await prisma.booking.count({ where: { orderItem: { orderId: id } } })).toBe(0);
    await payFully(id);
    const bookings = await prisma.booking.findMany({ where: { orderItem: { orderId: id } } });
    return { gym, member, id, bookings };
  }

  it("a paid service order creates one PENDING booking whose total sessions = sessionCount x quantity; none before payment", async () => {
    const { member, bookings } = await paidService(5, 2);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ sessionsTotal: 10, sessionsUsed: 0, status: "PENDING", memberId: member.id });
  });

  it("replaying the paid webhook doesn't create a second booking", async () => {
    const { id } = await paidService(3, 1);
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: id } });
    await sandboxWebhook(paidEvent(pay));
    expect(await prisma.booking.count({ where: { orderItem: { orderId: id } } })).toBe(1);
  });

  it("a failed payment creates no booking", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id, { kind: "SERVICE", sessionCount: 4 });
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "sandbox" } }), params({ id }));
    await sandboxWebhook(paidEvent(await prisma.payment.findFirstOrThrow({ where: { orderId: id } }), "FAILED"));
    expect(await prisma.booking.count({ where: { gymId: gym.id } })).toBe(0);
  });

  it("a bundle containing a service books each service with the bundle quantity applied", async () => {
    const gym = await (async () => {
      const { gym } = await makeGym();
      await signInStaff(gym.id, "OWNER");
      return gym;
    })();
    const svc = await makeListing(gym.id, { kind: "SERVICE", price: 80_000, sessionCount: 3 });
    const prod = await makeListing(gym.id, { price: 40_000, inventory: 10 });
    const cat = await makeCategory("SERVICE");
    expect((await createBundleRoute(req("/api/gym/products/bundles", { body: { name: "PT pack", categoryId: cat.id, priceRupees: 1000, items: [{ productId: svc.id, quantity: 2 }, { productId: prod.id, quantity: 1 }] } }), params())).status).toBe(200);
    const bundle = await prisma.marketplaceProduct.findFirstOrThrow({ where: { name: "PT pack" } });
    signOut();
    const m = await makeMember(gym.id);
    await signInMember(gym.id, m.id);
    const id = await orderId(await order([{ productId: bundle.id, quantity: 2 }]));
    await payFully(id);
    const bookings = await prisma.booking.findMany({ where: { orderItem: { orderId: id } } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.sessionsTotal).toBe(3 * 2 * 2);
  });

  it("staff can record sessions used up to the total, never above it; negative is refused", async () => {
    const { gym, bookings } = await paidService(4, 1);
    const b = bookings[0]!;
    signOut();
    await signInStaff(gym.id, "MANAGER");
    const patch = (body: Record<string, unknown>) => patchBooking(req(`/api/gym/bookings/${b.id}`, { method: "PATCH", body }), params({ id: b.id }));
    expect((await patch({ sessionsUsed: 5 })).status).toBe(400);
    expect((await patch({ sessionsUsed: -1 })).status).toBe(400);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).sessionsUsed).toBe(0);
    expect((await patch({ sessionsUsed: 4, status: "COMPLETED" })).status).toBe(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ sessionsUsed: 4, status: "COMPLETED", sessionsTotal: 4 });
  });

  it("a client can't change sessionsTotal through the booking PATCH", async () => {
    const { gym, bookings } = await paidService(2, 1);
    const b = bookings[0]!;
    signOut();
    await signInStaff(gym.id, "OWNER");
    await patchBooking(req(`/api/gym/bookings/${b.id}`, { method: "PATCH", body: { sessionsTotal: 999, sessionsUsed: 1 } }), params({ id: b.id }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).sessionsTotal).toBe(2);
  });

  it("another gym can't see or edit the booking; STAFF can't list bookings", async () => {
    const { gym, bookings } = await paidService(2, 1);
    const b = bookings[0]!;
    signOut();
    const other = await makeGym();
    await signInStaff(other.gym.id, "OWNER");
    expect((await patchBooking(req(`/api/gym/bookings/${b.id}`, { method: "PATCH", body: { sessionsUsed: 1 } }), params({ id: b.id }))).status).toBe(404);
    expect(unwrap<unknown[]>(await json(await listBookings(req("/api/gym/bookings"), params())))).toHaveLength(0);
    signOut();
    await signInStaff(gym.id, "STAFF");
    expect((await listBookings(req("/api/gym/bookings"), params())).status).toBe(403);
  });

  it("a trainer sees and edits only their own bookings", async () => {
    const { gym } = await makeGym();
    const trainerUser = await signInStaff(gym.id, "TRAINER");
    signOut();
    const member = await makeMember(gym.id);
    await signInMember(gym.id, member.id);
    const mine = await makeListing(gym.id, { kind: "SERVICE", sessionCount: 2, trainerId: trainerUser.staff.id });
    const theirs = await makeListing(gym.id, { kind: "SERVICE", sessionCount: 2 });
    const i1 = await orderId(await order([{ productId: mine.id, quantity: 1 }]));
    const i2 = await orderId(await order([{ productId: theirs.id, quantity: 1 }]));
    await payFully(i1);
    await payFully(i2);
    signOut();
    const { signInUser } = await import("./helpers/route");
    await signInUser(trainerUser.user.id, gym.id);
    const list = unwrap<{ id: string }[]>(await json(await listBookings(req("/api/gym/bookings"), params())));
    expect(list).toHaveLength(1);
    const other = await prisma.booking.findFirstOrThrow({ where: { orderItem: { orderId: i2 } } });
    expect((await patchBooking(req(`/api/gym/bookings/${other.id}`, { method: "PATCH", body: { sessionsUsed: 1 } }), params({ id: other.id }))).status).toBe(404);
  });
});

describe("duplicate order payments", () => {
  it("errors surface as JSON codes for unavailable providers on order checkout", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id);
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    const res = await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "khalti" } }), params({ id }));
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe("provider_unavailable");
  });

  it("a paid order can't be paid again (400) and no extra payment row appears", async () => {
    const { gym } = await buyer();
    const p = await makeListing(gym.id);
    const id = await orderId(await order([{ productId: p.id, quantity: 1 }]));
    await payFully(id);
    const res = await payOrder(req(`/api/me/orders/${id}/pay`, { body: { provider: "sandbox" } }), params({ id }));
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { orderId: id } })).toBe(1);
  });
});
