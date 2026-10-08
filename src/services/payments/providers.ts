import { hmacSha256, safeEqual, signingSecret } from "@/lib/crypto";
import type { ProviderEnvironment } from "@/generated/prisma/enums";

export type CheckoutInstruction =
  | { type: "redirect"; url: string }
  | { type: "form"; url: string; fields: Record<string, string> };

export type VerifiedEvent = {
  eventId: string;
  reference: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  amountPaisa: number | null;
  providerRef?: string;
  raw: unknown;
};

export type InitiateInput = {
  reference: string;
  amountPaisa: number;
  productName: string;
  returnUrl: string;
  failureUrl: string;
  customer: { name: string; phone?: string | null; email?: string | null };
};

export type ProviderAdapter = {
  key: string;
  name: string;
  credentialFields: string[];
  methods: string[];
  initiate(input: InitiateInput, creds: Record<string, string>, env: ProviderEnvironment): Promise<CheckoutInstruction & { providerRef?: string }>;
  /** Verifies a return/callback. Must confirm with the provider server-side; the browser's word is never enough. */
  verifyReturn(query: URLSearchParams, creds: Record<string, string>, env: ProviderEnvironment, expected: { reference: string; amountPaisa: number; providerRef?: string | null }): Promise<VerifiedEvent>;
  /** Verifies a server-to-server webhook body + headers. */
  verifyWebhook?(rawBody: string, headers: Headers, creds: Record<string, string>): Promise<VerifiedEvent>;
};

export class VerificationError extends Error {}

const rupees = (paisa: number) => (paisa % 100 === 0 ? String(paisa / 100) : (paisa / 100).toFixed(2));

// ─────────────────────────────── eSewa ePay v2 ───────────────────────────────

const ESEWA = {
  SANDBOX: { form: "https://rc-epay.esewa.com.np/api/epay/main/v2/form", status: "https://rc.esewa.com.np/api/epay/transaction/status/" },
  LIVE: { form: "https://epay.esewa.com.np/api/epay/main/v2/form", status: "https://epay.esewa.com.np/api/epay/transaction/status/" },
};

export function esewaSignature(secret: string, fields: Record<string, string>, signedFieldNames: string) {
  const message = signedFieldNames
    .split(",")
    .map((f) => `${f}=${fields[f] ?? ""}`)
    .join(",");
  return hmacSha256(secret, message, "base64");
}

export const esewa: ProviderAdapter = {
  key: "esewa",
  name: "eSewa",
  credentialFields: ["productCode", "secretKey"],
  methods: ["wallet"],
  async initiate(input, creds, env) {
    const total = rupees(input.amountPaisa);
    const fields: Record<string, string> = {
      amount: total,
      tax_amount: "0",
      total_amount: total,
      transaction_uuid: input.reference,
      product_code: creds.productCode!,
      product_service_charge: "0",
      product_delivery_charge: "0",
      success_url: input.returnUrl,
      failure_url: input.failureUrl,
      signed_field_names: "total_amount,transaction_uuid,product_code",
    };
    fields.signature = esewaSignature(creds.secretKey!, fields, fields.signed_field_names!);
    return { type: "form", url: ESEWA[env].form, fields };
  },
  async verifyReturn(query, creds, env, expected) {
    const data = query.get("data");
    if (data) {
      let payload: Record<string, string>;
      try {
        payload = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
      } catch {
        throw new VerificationError("Malformed eSewa response");
      }
      const sig = esewaSignature(creds.secretKey!, payload, payload.signed_field_names ?? "");
      if (!payload.signature || !safeEqual(sig, payload.signature)) throw new VerificationError("eSewa signature mismatch");
      if (payload.transaction_uuid !== expected.reference) throw new VerificationError("eSewa reference mismatch");
    }
    // Always confirm with eSewa's status API — this is the authoritative check.
    const url = new URL(ESEWA[env].status);
    url.searchParams.set("product_code", creds.productCode!);
    url.searchParams.set("total_amount", rupees(expected.amountPaisa));
    url.searchParams.set("transaction_uuid", expected.reference);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`eSewa status check failed (${res.status})`);
    const s = (await res.json()) as { status?: string; ref_id?: string | null; total_amount?: number | string };
    const status = s.status === "COMPLETE" ? "SUCCEEDED" : s.status === "PENDING" || s.status === "AMBIGUOUS" ? "PENDING" : "FAILED";
    return {
      eventId: `${expected.reference}:${s.status}:${s.ref_id ?? ""}`,
      reference: expected.reference,
      status,
      amountPaisa: s.total_amount !== undefined ? Math.round(Number(s.total_amount) * 100) : null,
      providerRef: s.ref_id ?? undefined,
      raw: s,
    };
  },
};

// ─────────────────────────────── Khalti KPG-2 ───────────────────────────────

const KHALTI = { SANDBOX: "https://dev.khalti.com/api/v2", LIVE: "https://khalti.com/api/v2" };

export const khalti: ProviderAdapter = {
  key: "khalti",
  name: "Khalti",
  credentialFields: ["secretKey"],
  methods: ["wallet", "ebanking", "mobile_banking", "connect_ips", "sct"],
  async initiate(input, creds, env) {
    const res = await fetch(`${KHALTI[env]}/epayment/initiate/`, {
      method: "POST",
      headers: { authorization: `Key ${creds.secretKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        return_url: input.returnUrl,
        website_url: new URL(input.returnUrl).origin,
        amount: input.amountPaisa,
        purchase_order_id: input.reference,
        purchase_order_name: input.productName.slice(0, 100),
        customer_info: { name: input.customer.name, phone: input.customer.phone ?? undefined, email: input.customer.email ?? undefined },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { pidx?: string; payment_url?: string; detail?: string };
    if (!res.ok || !json.payment_url) throw new Error(`Khalti initiate failed: ${json.detail ?? res.status}`);
    return { type: "redirect", url: json.payment_url, providerRef: json.pidx };
  },
  async verifyReturn(query, creds, env, expected) {
    const pidx = query.get("pidx");
    if (!pidx) throw new VerificationError("Missing pidx");
    if (expected.providerRef && pidx !== expected.providerRef) throw new VerificationError("Khalti pidx mismatch");
    const res = await fetch(`${KHALTI[env]}/epayment/lookup/`, {
      method: "POST",
      headers: { authorization: `Key ${creds.secretKey}`, "content-type": "application/json" },
      body: JSON.stringify({ pidx }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status >= 500) throw new Error(`Khalti lookup failed (${res.status})`);
    const s = (await res.json()) as { status?: string; total_amount?: number; transaction_id?: string | null };
    const status = s.status === "Completed" ? "SUCCEEDED" : s.status === "Pending" || s.status === "Initiated" ? "PENDING" : "FAILED";
    return { eventId: `${pidx}:${s.status}`, reference: expected.reference, status, amountPaisa: s.total_amount ?? null, providerRef: pidx, raw: s };
  },
};

// ─────────────────────────────── Sandbox (non-production only) ───────────────────────────────

/**
 * The test gateway lets a member approve their own payment, so it is opt-in: it needs ENABLE_TEST_GATEWAY=true and
 * is never available in production. (Failing open on a missing APP_ENV would hand out free memberships.)
 */
export function testGatewayEnabled() {
  return process.env.ENABLE_TEST_GATEWAY === "true" && process.env.APP_ENV !== "production";
}

export function sandboxSecret() {
  return hmacSha256(signingSecret(), "gympulse-sandbox-webhook");
}

export function signSandboxWebhook(body: string) {
  return hmacSha256(sandboxSecret(), body);
}

export const sandbox: ProviderAdapter = {
  key: "sandbox",
  name: "GymPulse Test Gateway",
  credentialFields: [],
  methods: ["test"],
  async initiate(input) {
    if (!testGatewayEnabled()) throw new Error("The test gateway is disabled");
    return { type: "redirect", url: `/pay/sandbox/${encodeURIComponent(input.reference)}` };
  },
  async verifyReturn() {
    // The sandbox confirms only via its signed webhook, never via the browser return.
    throw new VerificationError("Sandbox payments are confirmed by webhook only");
  },
  async verifyWebhook(rawBody, headers) {
    if (!testGatewayEnabled()) throw new VerificationError("The test gateway is disabled");
    const sig = headers.get("x-gympulse-signature") ?? "";
    if (!safeEqual(sig, signSandboxWebhook(rawBody))) throw new VerificationError("Sandbox signature mismatch");
    const evt = JSON.parse(rawBody) as { id: string; reference: string; status: "SUCCEEDED" | "FAILED"; amountPaisa: number };
    return { eventId: evt.id, reference: evt.reference, status: evt.status, amountPaisa: evt.amountPaisa, raw: evt };
  },
};

export const PAYMENT_ADAPTERS: Record<string, ProviderAdapter> = { esewa, khalti, sandbox };
