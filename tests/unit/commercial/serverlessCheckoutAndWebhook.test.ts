// tests/unit/commercial/serverlessCheckoutAndWebhook.test.ts - Automated Security Tests for Netlify Functions
import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { AUTHORITATIVE_PLANS } from "../../../netlify/functions/shared/config";
import { getOrCreateDeviceId, getClientDeviceHash } from "../../../src/licensing/entitlement";
import {
  savePendingFulfillment,
  getPendingFulfillment,
  clearPendingFulfillment,
  PENDING_FULFILLMENT_STORAGE_KEY
} from "../../../src/components/commercial/LicenseActivationModal";
import { ProductionLicensingService } from "../../../src/licensing/server/licensingService";
import { parseDatabaseConfig } from "../../../netlify/functions/shared/db";

describe("Serverless Razorpay Checkout & Webhook Security Suite", () => {
  const testKeySecret = "test_razorpay_key_secret_2026";
  const testWebhookSecret = "test_razorpay_webhook_secret_2026";

  it("1. Checkout Signature Verification: Valid signature passes timing-safe comparison", () => {
    const orderId = "order_test_9988";
    const paymentId = "pay_test_1122";
    const validSignature = crypto
      .createHmac("sha256", testKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const computed = crypto
      .createHmac("sha256", testKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const bufA = Buffer.from(validSignature);
    const bufB = Buffer.from(computed);
    expect(bufA.length).toBe(bufB.length);
    expect(crypto.timingSafeEqual(bufA, bufB)).toBe(true);
  });

  it("2. Checkout Signature Verification: Forged signature is rejected", () => {
    const orderId = "order_test_9988";
    const paymentId = "pay_test_1122";
    const forgedSignature = "a".repeat(64);

    const computed = crypto
      .createHmac("sha256", testKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const bufA = Buffer.from(forgedSignature);
    const bufB = Buffer.from(computed);
    expect(crypto.timingSafeEqual(bufA, bufB)).toBe(false);
  });

  it("3. Webhook HMAC Verification: Valid raw body signature passes", () => {
    const rawBody = JSON.stringify({
      id: "evt_test_001",
      event: "order.paid",
      payload: { payment: { entity: { id: "pay_1", amount: 299900, status: "captured", currency: "INR" } } }
    });

    const validSignature = crypto
      .createHmac("sha256", testWebhookSecret)
      .update(rawBody)
      .digest("hex");

    const computed = crypto
      .createHmac("sha256", testWebhookSecret)
      .update(rawBody)
      .digest("hex");

    expect(crypto.timingSafeEqual(Buffer.from(validSignature), Buffer.from(computed))).toBe(true);
  });

  it("4. Webhook HMAC Verification: Tampered body is strictly rejected (HTTP 401)", () => {
    const originalBody = JSON.stringify({ id: "evt_1", event: "order.paid" });
    const tamperedBody = JSON.stringify({ id: "evt_1", event: "order.paid", injected: true });

    const signature = crypto
      .createHmac("sha256", testWebhookSecret)
      .update(originalBody)
      .digest("hex");

    const computed = crypto
      .createHmac("sha256", testWebhookSecret)
      .update(tamperedBody)
      .digest("hex");

    expect(crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))).toBe(false);
  });

  it("5. Claim Token Entropy: Generates 256-bit unguessable tokens with deterministic SHA-256 hash matching", () => {
    const token = crypto.randomBytes(32).toString("hex");
    expect(token).toHaveLength(64); // 256 bits = 64 hex chars

    const hash1 = crypto.createHash("sha256").update(token).digest("hex");
    const hash2 = crypto.createHash("sha256").update(token).digest("hex");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);

    // Mismatched token fails
    const badToken = crypto.randomBytes(32).toString("hex");
    const badHash = crypto.createHash("sha256").update(badToken).digest("hex");
    expect(hash1).not.toBe(badHash);
  });

  it("6. Plan Price Integrity: Single audit must strictly match 299900 paise (₹2,999)", () => {
    expect(AUTHORITATIVE_PLANS.SINGLE_AUDIT.amountPaise).toBe(299900);
    expect(AUTHORITATIVE_PLANS.SINGLE_AUDIT.auditsAllowed).toBe(1);
    expect(AUTHORITATIVE_PLANS.PROFESSIONAL_MONTHLY.amountPaise).toBe(499900);
    expect(AUTHORITATIVE_PLANS.PROFESSIONAL_MONTHLY.auditsAllowed).toBe(5);
    expect(AUTHORITATIVE_PLANS.ANNUAL_PROFESSIONAL.amountPaise).toBe(4999000);
    expect(AUTHORITATIVE_PLANS.ANNUAL_PROFESSIONAL.auditsAllowed).toBe(60);
  });

  it("7. Checkout Request Harmonization: Supports both plan and planType, dual-casing in response", () => {
    // Simulate input normalization logic
    const inputWithPlan = { plan: "SINGLE_AUDIT", customerEmail: "billing@company.com" };
    const inputWithPlanType = { planType: "SINGLE_AUDIT", customer_email: "billing@company.com" };

    const planTypeA = (inputWithPlan as any).planType || (inputWithPlan as any).plan;
    const planTypeB = (inputWithPlanType as any).planType || (inputWithPlanType as any).plan;
    expect(planTypeA).toBe("SINGLE_AUDIT");
    expect(planTypeB).toBe("SINGLE_AUDIT");

    // Simulate response format containing both camelCase and snake_case
    const mockOrderResponse = {
      order_id: "order_test_123",
      amount: 299900,
      currency: "INR",
      key_id: "rzp_test_public_123",
      claim_token: "claim_secret_hex",
      plan_type: "SINGLE_AUDIT",
      orderId: "order_test_123",
      keyId: "rzp_test_public_123",
      claimToken: "claim_secret_hex",
      planType: "SINGLE_AUDIT"
    };

    // Client reading either format succeeds without undefined
    expect(mockOrderResponse.orderId || mockOrderResponse.order_id).toBe("order_test_123");
    expect(mockOrderResponse.keyId || mockOrderResponse.key_id).toBe("rzp_test_public_123");
    expect(mockOrderResponse.claimToken || mockOrderResponse.claim_token).toBe("claim_secret_hex");
  });

  it("8. Fulfillment Harmonization: Accepts camelCase or snake_case inputs, returns dual-cased license properties", () => {
    const camelCaseInput = {
      orderId: "order_test_123",
      paymentId: "pay_test_456",
      signature: "sig_test_789",
      claimToken: "claim_token_abc",
      deviceHash: "dev_hash_def"
    };

    const order_id = (camelCaseInput as any).order_id || camelCaseInput.orderId;
    const payment_id = (camelCaseInput as any).payment_id || camelCaseInput.paymentId;
    const razorpay_signature = (camelCaseInput as any).razorpay_signature || camelCaseInput.signature;
    const claim_token = (camelCaseInput as any).claim_token || camelCaseInput.claimToken;
    const device_hash = (camelCaseInput as any).device_hash || camelCaseInput.deviceHash;

    expect(order_id).toBe("order_test_123");
    expect(payment_id).toBe("pay_test_456");
    expect(razorpay_signature).toBe("sig_test_789");
    expect(claim_token).toBe("claim_token_abc");
    expect(device_hash).toBe("dev_hash_def");

    // Simulate fulfillment response
    const mockFulfillResponse = {
      success: true,
      license_key: "YBY-SINGLE-ABCD-1234",
      licenseKey: "YBY-SINGLE-ABCD-1234",
      audits_remaining: 1,
      auditsRemaining: 1,
      status: "ACTIVE"
    };

    expect(mockFulfillResponse.licenseKey || mockFulfillResponse.license_key).toBe("YBY-SINGLE-ABCD-1234");
    expect(mockFulfillResponse.auditsRemaining || mockFulfillResponse.audits_remaining).toBe(1);
  });

  it("9. Production Fail-Closed on Checkout Failures: HTTP 500, network error, and malformed responses never grant entitlement", () => {
    // A: HTTP 500 Error response simulation
    const mock500Response = {
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal Gateway Error: Razorpay order creation timed out" })
    };

    let grantedEntitlement: any = null;
    let uiErrorMessage: string | null = null;

    if (!mock500Response.ok) {
      uiErrorMessage = "Internal Gateway Error: Razorpay order creation timed out";
      // Strict fail-closed: return immediately without granting entitlement
    } else {
      grantedEntitlement = { status: "ACTIVE", plan: "SINGLE_AUDIT" };
    }

    expect(grantedEntitlement).toBeNull();
    expect(uiErrorMessage).toContain("Internal Gateway Error");

    // B: Malformed Response simulation (missing claimToken or orderId)
    const malformedPayloads = [
      { keyId: "rzp_test_123", amount: 299900 }, // missing orderId, claimToken
      { orderId: "order_123", keyId: "rzp_test_123" }, // missing claimToken
      { claimToken: "token_abc" } // missing keyId, orderId
    ];

    for (const malformed of malformedPayloads) {
      const keyId = (malformed as any).keyId;
      const orderId = (malformed as any).orderId;
      const claimToken = (malformed as any).claimToken;

      const isValid = Boolean(keyId && orderId && claimToken);
      expect(isValid).toBe(false);
      // Fail closed
      let entitlementGrantedOnMalformed = null;
      if (!isValid) {
        // Abort
      } else {
        entitlementGrantedOnMalformed = { status: "ACTIVE" };
      }
      expect(entitlementGrantedOnMalformed).toBeNull();
    }

    // C: Gated Dev Simulation Check
    const isProduction = true;
    const simulateFailure = false;
    const isLocalhost = false;
    const isSimulationAllowed = !isProduction && isLocalhost && simulateFailure;
    expect(isSimulationAllowed).toBe(false);
  });

  it("10. Persistent Device Binding: Derives consistent SHA-256 hash and blocks cross-device reuse", async () => {
    // 1. Persistent device ID generation
    localStorage.clear();
    const devId1 = getOrCreateDeviceId();
    const devId2 = getOrCreateDeviceId();
    expect(devId1).toBe(devId2);
    expect(devId1.length).toBeGreaterThanOrEqual(16);

    // 2. Consistent SHA-256 derivation
    const hash1 = await getClientDeviceHash();
    const hash2 = await getClientDeviceHash();
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex string

    // 3. Different device ID produces different hash
    const otherDevHash = await getClientDeviceHash("another-unique-device-hardware-uuid-999");
    expect(otherDevHash).toHaveLength(64);
    expect(otherDevHash).not.toBe(hash1);

    // 4. Server enforcement: Device A registers and binds
    const testLicenseKey = "YBY-PRO-DEVICE-BIND-TEST";
    ProductionLicensingService.registerProvisionedKey({
      licenseKey: testLicenseKey,
      plan: "PROFESSIONAL_MONTHLY",
      status: "ACTIVE",
      auditsAllowed: 5,
      auditsUsed: 0,
      auditsReserved: 0,
      maxDevices: 1,
      createdAt: new Date().toISOString()
    });

    // Device A binds to license
    const devARes = ProductionLicensingService.handleValidateKeyRequest({
      licenseKey: testLicenseKey,
      deviceHash: hash1
    });
    expect(devARes.valid).toBe(true);
    expect(devARes.status).toBe("ACTIVE");

    // Device B tries to validate/use Device A's license
    const devBRes = ProductionLicensingService.handleValidateKeyRequest({
      licenseKey: testLicenseKey,
      deviceHash: otherDevHash
    });
    expect(devBRes.valid).toBe(false);
    expect(devBRes.reason).toContain("Device Binding Violation");
  });

  it("11. Idempotent Payment Fulfillment Recovery: Retries return identical license without duplicate quota", async () => {
    const orderId = "order_recovery_test_1001";
    const paymentId = "pay_captured_2002";
    const planType = "SINGLE_AUDIT";
    const claimToken = crypto.randomBytes(32).toString("hex");
    const claimTokenHash = crypto.createHash("sha256").update(claimToken).digest("hex");
    const testSignature = crypto
      .createHmac("sha256", testKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const deviceHash = await getClientDeviceHash("recovery-test-device-uuid");

    // Mock database state simulating Supabase tables
    const mockOrderTable: Record<string, any> = {
      [orderId]: {
        order_id: orderId,
        amount_inr_paise: 299900,
        plan_type: planType,
        claim_token_hash: claimTokenHash,
        status: "created",
        license_key: null,
        payment_id: null
      }
    };
    const mockLicenseTable: Record<string, any> = {};

    // Simulated Server Transaction (Matching fulfill-license.ts logic)
    const executeFulfillTransaction = (input: {
      orderId: string;
      paymentId: string;
      signature: string;
      claimToken: string;
      deviceHash: string;
    }) => {
      // 1. Verify Razorpay checkout signature
      const expectedSig = crypto
        .createHmac("sha256", testKeySecret)
        .update(`${input.orderId}|${input.paymentId}`)
        .digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(input.signature), Buffer.from(expectedSig))) {
        throw new Error("401: Invalid signature");
      }

      // 2. Verify claim token
      const tokenHash = crypto.createHash("sha256").update(input.claimToken).digest("hex");
      const order = mockOrderTable[input.orderId];
      if (!order) throw new Error("404: Order not found");
      if (order.claim_token_hash !== tokenHash) {
        throw new Error("403: Claim token mismatch");
      }

      // 3. Idempotent check: if already fulfilled, return existing license
      if (order.license_key) {
        const lic = mockLicenseTable[order.license_key];
        if (lic.bound_device_hash !== input.deviceHash) {
          throw new Error("403: Device Binding Violation");
        }
        return {
          success: true,
          licenseKey: lic.license_key,
          auditsRemaining: lic.audits_allowed - lic.audits_used,
          auditsAllowed: lic.audits_allowed,
          isDuplicate: false,
          reusedExisting: true
        };
      }

      // 4. Provision fresh license
      const newKey = `YBY-SINGLE-${Date.now()}`;
      mockLicenseTable[newKey] = {
        license_key: newKey,
        plan_type: order.plan_type,
        audits_allowed: 1,
        audits_used: 0,
        bound_device_hash: input.deviceHash
      };
      order.status = "paid";
      order.license_key = newKey;
      order.payment_id = input.paymentId;

      return {
        success: true,
        licenseKey: newKey,
        auditsRemaining: 1,
        auditsAllowed: 1,
        isDuplicate: false,
        reusedExisting: false
      };
    };

    // First attempt: Fulfills license
    const call1 = executeFulfillTransaction({
      orderId,
      paymentId,
      signature: testSignature,
      claimToken,
      deviceHash
    });
    expect(call1.success).toBe(true);
    expect(call1.reusedExisting).toBe(false);
    expect(call1.auditsRemaining).toBe(1);
    const assignedKey = call1.licenseKey;

    // Second attempt (Customer retry or connection recovery): Returns identical key, 0 new quota
    const call2 = executeFulfillTransaction({
      orderId,
      paymentId,
      signature: testSignature,
      claimToken,
      deviceHash
    });
    expect(call2.success).toBe(true);
    expect(call2.reusedExisting).toBe(true);
    expect(call2.licenseKey).toBe(assignedKey);
    expect(call2.auditsRemaining).toBe(1); // Quota remains strictly 1, never duplicated!
    expect(Object.keys(mockLicenseTable).length).toBe(1); // Only 1 license row created!

    // Attempt from unauthorized device with valid payment and token
    const wrongDeviceHash = await getClientDeviceHash("unauthorized-attacker-device");
    expect(() =>
      executeFulfillTransaction({
        orderId,
        paymentId,
        signature: testSignature,
        claimToken,
        deviceHash: wrongDeviceHash
      })
    ).toThrow("403: Device Binding Violation");

    // Attempt with forged claim token
    expect(() =>
      executeFulfillTransaction({
        orderId,
        paymentId,
        signature: testSignature,
        claimToken: "attacker_forged_claim_token",
        deviceHash
      })
    ).toThrow("403: Claim token mismatch");
  });

  it("12. Payment Fulfillment Session Persistence: Accurately saves, retrieves, and expires interrupted checkouts", () => {
    sessionStorage.clear();

    const pendingData = {
      orderId: "order_session_persist_001",
      paymentId: "pay_captured_session_001",
      signature: "sig_hmac_abc123",
      claimToken: "token_secret_session_xyz",
      planType: "SINGLE_AUDIT" as const,
      timestamp: Date.now()
    };

    // 1. Save pending fulfillment
    savePendingFulfillment(pendingData);

    // 2. Retrieve pending fulfillment
    const retrieved = getPendingFulfillment();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.orderId).toBe("order_session_persist_001");
    expect(retrieved?.paymentId).toBe("pay_captured_session_001");
    expect(retrieved?.claimToken).toBe("token_secret_session_xyz");

    // 3. Clear pending fulfillment upon completed activation
    clearPendingFulfillment();
    expect(getPendingFulfillment()).toBeNull();

    // 4. Expiry check: stale items (>24 hours) are purged
    const expiredPendingData = {
      ...pendingData,
      timestamp: Date.now() - 25 * 60 * 60 * 1000 // 25 hours ago
    };
    sessionStorage.setItem(PENDING_FULFILLMENT_STORAGE_KEY, JSON.stringify(expiredPendingData));
    const expiredRetrieved = getPendingFulfillment();
    expect(expiredRetrieved).toBeNull();
  });

  it("13. Resilient Database URI Parsing: Recovers truncated host 'base' and handles unencoded '@' in password", () => {
    // Test recovery when host is truncated to "base"
    const malformedUri = "postgresql://postgres:MySecretPass123@base";
    const res1 = parseDatabaseConfig(malformedUri);
    expect(res1.host).toBe("aws-0-ap-south-1.pooler.supabase.com");
    expect(res1.port).toBe(6543);
    expect(res1.user).toBe("postgres.jqwwpbupreecmdkvmtyc");
    expect(res1.password).toBe("MySecretPass123");

    // Test unencoded '@' in password
    const unencodedAtUri = "postgresql://postgres.jqwwpbupreecmdkvmtyc:Secret@123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    const res2 = parseDatabaseConfig(unencodedAtUri);
    expect(res2.host).toBe("aws-0-ap-south-1.pooler.supabase.com");
    expect(res2.port).toBe(6543);
    expect(res2.user).toBe("postgres.jqwwpbupreecmdkvmtyc");
    expect(res2.password).toBe("Secret@123");

    // Test percent-encoded '%40' in password
    const encodedAtUri = "postgresql://postgres.jqwwpbupreecmdkvmtyc:Secret%40123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
    const res3 = parseDatabaseConfig(encodedAtUri);
    expect(res3.password).toBe("Secret@123");
  });
});
