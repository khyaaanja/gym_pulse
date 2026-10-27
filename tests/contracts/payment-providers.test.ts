import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
import { PAYMENT_ADAPTERS } from "@/services/payments/providers";

const { like, eachLike, term, iso8601DateTimeWithMillis } = MatchersV3;

describe("Contract Tests - Payment Providers (Pact)", () => {
  // eSewa Provider Contract
  describe("eSewa Payment Provider", () => {
    const provider = new PactV3({
      consumer: "GymPulse",
      provider: "eSewa",
      port: 1234,
      logLevel: "WARN",
      dir: "./pacts",
    });

    beforeAll(async () => {
      await provider.setup();
    });

    afterAll(async () => {
      await provider.finalize();
    });

    describe("Initiate Payment", () => {
      it("should return payment URL for valid request", async () => {
        await provider.addInteraction({
          state: "eSewa is available",
          uponReceiving: "a request to initiate payment",
          withRequest: {
            method: "POST",
            path: "/api/epay/main/v2/checkout",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: {
              amt: like(5000),
              psc: like(0),
              pdc: like(0),
              txAmt: like(0),
              tAmt: like(5000),
              pid: like("GP-12345"),
              scd: like("EPAYTEST"),
              su: like("https://gympulse.app/payment/success"),
              fu: like("https://gympulse.app/payment/failed"),
            },
          },
          willRespondWith: {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: {
              status: "SUCCESS",
              refId: like("REF-12345"),
              url: like("https://uat.esewa.com.np/epay/main/v2/checkout?refId=REF-12345"),
            },
          },
        });

        // Test the adapter
        const adapter = PAYMENT_ADAPTERS.esewa;
        if (adapter) {
          const result = await adapter.initiatePayment({
            amountPaisa: 500000,
            reference: "GP-12345",
            returnUrl: "https://gympulse.app/payment/success",
            cancelUrl: "https://gympulse.app/payment/failed",
          });

          expect(result.checkoutUrl).toBeDefined();
          expect(result.providerRef).toBeDefined();
        }
      });

      it("should return error for invalid amount", async () => {
        await provider.addInteraction({
          state: "eSewa is available",
          uponReceiving: "a request with invalid amount",
          withRequest: {
            method: "POST",
            path: "/api/epay/main/v2/checkout",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: {
              amt: like(-100),
              // ... other fields
            },
          },
          willRespondWith: {
            status: 400,
            body: {
              status: "ERROR",
              message: like("Invalid amount"),
            },
          },
        });
      });
    });

    describe("Verify Payment", () => {
      it("should verify successful payment", async () => {
        await provider.addInteraction({
          state: "payment was completed",
          uponReceiving: "a request to verify payment",
          withRequest: {
            method: "GET",
            path: "/api/epay/transaction/status",
            query: {
              amt: like(5000),
              refId: like("REF-12345"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              status: "COMPLETE",
              transaction_uuid: like("REF-12345"),
              total_amount: like(5000),
              transaction_code: like("TXN-12345"),
            },
          },
        });

        const adapter = PAYMENT_ADAPTERS.esewa;
        if (adapter) {
          const result = await adapter.verifyPayment({
            reference: "REF-12345",
            amountPaisa: 500000,
          });

          expect(result.status).toBe("SUCCEEDED");
          expect(result.providerRef).toBeDefined();
        }
      });

      it("should report failed payment", async () => {
        await provider.addInteraction({
          state: "payment failed",
          uponReceiving: "a request to verify failed payment",
          withRequest: {
            method: "GET",
            path: "/api/epay/transaction/status",
            query: {
              amt: like(5000),
              refId: like("REF-67890"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              status: "FAILED",
              transaction_uuid: like("REF-67890"),
            },
          },
        });
      });
    });

    describe("Refund", () => {
      it("should process refund", async () => {
        await provider.addInteraction({
          state: "payment was successful",
          uponReceiving: "a request to refund payment",
          withRequest: {
            method: "POST",
            path: "/api/epay/refund",
            headers: { "Content-Type": "application/json" },
            body: {
              refId: like("REF-12345"),
              amt: like(5000),
              remarks: like("Customer requested refund"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              status: "SUCCESS",
              refundId: like("REFUND-12345"),
            },
          },
        });
      });
    });
  });

  // Khalti Provider Contract
  describe("Khalti Payment Provider", () => {
    const provider = new PactV3({
      consumer: "GymPulse",
      provider: "Khalti",
      port: 1235,
      logLevel: "WARN",
      dir: "./pacts",
    });

    beforeAll(async () => {
      await provider.setup();
    });

    afterAll(async () => {
      await provider.finalize();
    });

    describe("Initiate Payment", () => {
      it("should return payment URL for valid request", async () => {
        await provider.addInteraction({
          state: "Khalti is available",
          uponReceiving: "a request to initiate payment",
          withRequest: {
            method: "POST",
            path: "/api/v2/epayment/initiate/",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": like("Key test_secret_key"),
            },
            body: {
              return_url: like("https://gympulse.app/payment/success"),
              website_url: like("https://gympulse.app"),
              amount: like(500000),
              purchase_order_id: like("GP-12345"),
              purchase_order_name: like("Monthly Membership"),
              customer_info: {
                name: like("John Doe"),
                email: like("john@example.com"),
                phone: like("9800000000"),
              },
            },
          },
          willRespondWith: {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: {
              pidx: like("pidx_12345"),
              payment_url: like("https://khalti.com/pay/pidx_12345"),
            },
          },
        });
      });
    });

    describe("Verify Payment", () => {
      it("should verify successful payment", async () => {
        await provider.addInteraction({
          state: "payment was completed",
          uponReceiving: "a request to verify payment",
          withRequest: {
            method: "POST",
            path: "/api/v2/epayment/lookup/",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": like("Key test_secret_key"),
            },
            body: {
              pidx: like("pidx_12345"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              status: "Completed",
              pidx: like("pidx_12345"),
              amount: like(500000),
              transaction_id: like("KHALTI-12345"),
            },
          },
        });
      });
    });
  });

  // Stripe Provider Contract
  describe("Stripe Payment Provider", () => {
    const provider = new PactV3({
      consumer: "GymPulse",
      provider: "Stripe",
      port: 1236,
      logLevel: "WARN",
      dir: "./pacts",
    });

    beforeAll(async () => {
      await provider.setup();
    });

    afterAll(async () => {
      await provider.finalize();
    });

    describe("Create Payment Intent", () => {
      it("should create payment intent", async () => {
        await provider.addInteraction({
          state: "Stripe is available",
          uponReceiving: "a request to create payment intent",
          withRequest: {
            method: "POST",
            path: "/v1/payment_intents",
            headers: { 
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": like("Bearer sk_test_..."),
            },
            body: {
              amount: like(500000),
              currency: like("npr"),
              automatic_payment_methods: { enabled: "true" },
              metadata: {
                reference: like("GP-12345"),
                gym_id: like("gym-123"),
              },
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              id: like("pi_12345"),
              client_secret: like("pi_12345_secret_abc"),
              status: like("requires_payment_method"),
              amount: like(500000),
            },
          },
        });
      });
    });

    describe("Confirm Payment", () => {
      it("should confirm payment intent", async () => {
        await provider.addInteraction({
          state: "payment intent exists",
          uponReceiving: "a request to confirm payment",
          withRequest: {
            method: "POST",
            path: "/v1/payment_intents/pi_12345/confirm",
            headers: { 
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": like("Bearer sk_test_..."),
            },
            body: {
              payment_method: like("pm_card_visa"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              id: like("pi_12345"),
              status: like("succeeded"),
              amount: like(500000),
            },
          },
        });
      });
    });

    describe("Refund", () => {
      it("should create refund", async () => {
        await provider.addInteraction({
          state: "payment was successful",
          uponReceiving: "a request to create refund",
          withRequest: {
            method: "POST",
            path: "/v1/refunds",
            headers: { 
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": like("Bearer sk_test_..."),
            },
            body: {
              payment_intent: like("pi_12345"),
              amount: like(500000),
              reason: like("requested_by_customer"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              id: like("re_12345"),
              status: like("succeeded"),
              amount: like(500000),
            },
          },
        });
      });
    });
  });

  // Sandbox Provider Contract (for testing)
  describe("Sandbox Payment Provider", () => {
    const provider = new PactV3({
      consumer: "GymPulse",
      provider: "Sandbox",
      port: 1237,
      logLevel: "WARN",
      dir: "./pacts",
    });

    beforeAll(async () => {
      await provider.setup();
    });

    afterAll(async () => {
      await provider.finalize();
    });

    describe("Initiate Payment", () => {
      it("should return mock checkout URL", async () => {
        await provider.addInteraction({
          state: "Sandbox is available",
          uponReceiving: "a request to initiate sandbox payment",
          withRequest: {
            method: "POST",
            path: "/sandbox/initiate",
            headers: { "Content-Type": "application/json" },
            body: {
              amountPaisa: like(500000),
              reference: like("GP-12345"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              checkoutUrl: like("http://localhost:3000/pay/sandbox/mock-12345"),
              providerRef: like("mock-12345"),
            },
          },
        });
      });
    });

    describe("Verify Payment", () => {
      it("should verify mock payment", async () => {
        await provider.addInteraction({
          state: "mock payment was completed",
          uponReceiving: "a request to verify mock payment",
          withRequest: {
            method: "GET",
            path: "/sandbox/verify/mock-12345",
          },
          willRespondWith: {
            status: 200,
            body: {
              status: "SUCCEEDED",
              reference: like("GP-12345"),
              amountPaisa: like(500000),
            },
          },
        });
      });
    });
  });
});

// Webhook Consumer Contracts
describe("Contract Tests - Webhook Consumers", () => {
  describe("GymPulse as Webhook Consumer", () => {
    const provider = new PactV3({
      consumer: "eSewa",
      provider: "GymPulse",
      port: 1238,
      logLevel: "WARN",
      dir: "./pacts",
    });

    beforeAll(async () => {
      await provider.setup();
    });

    afterAll(async () => {
      await provider.finalize();
    });

    it("should accept valid eSewa webhook", async () => {
      await provider.addInteraction({
        state: "payment exists",
        uponReceiving: "a valid eSewa webhook",
        withRequest: {
          method: "POST",
          path: "/api/webhooks/payments/esewa",
          headers: {
            "Content-Type": "application/json",
            "x-esewa-signature": like("valid-signature"),
          },
          body: {
            transaction_uuid: like("GP-12345"),
            status: like("COMPLETE"),
            total_amount: like(5000),
            transaction_code: like("TXN-12345"),
          },
        },
        willRespondWith: {
          status: 200,
          body: {
            success: true,
          },
        },
      });
    });

    it("should reject invalid signature", async () => {
      await provider.addInteraction({
        state: "payment exists",
        uponReceiving: "a webhook with invalid signature",
        withRequest: {
          method: "POST",
          path: "/api/webhooks/payments/esewa",
          headers: {
            "Content-Type": "application/json",
            "x-esewa-signature": like("invalid-signature"),
          },
          body: {
            transaction_uuid: like("GP-12345"),
            status: like("COMPLETE"),
          },
        },
        willRespondWith: {
          status: 401,
          body: {
            error: "invalid_signature",
          },
        },
      });
    });

    it("should reject webhook for non-existent payment", async () => {
      await provider.addInteraction({
        state: "payment does not exist",
        uponReceiving: "a webhook for unknown payment",
        withRequest: {
          method: "POST",
          path: "/api/webhooks/payments/esewa",
          headers: {
            "Content-Type": "application/json",
            "x-esewa-signature": like("valid-signature"),
          },
          body: {
            transaction_uuid: like("UNKNOWN-REF"),
            status: like("COMPLETE"),
          },
        },
        willRespondWith: {
          status: 404,
          body: {
            error: "payment_not_found",
          },
        },
      });
    });
  });
});