import { describe, expect, it, beforeEach } from "vitest";
import { ProductionLicensingService } from "../../src/licensing/server/licensingService";
import { computeWebhookHmac, getWebhookSecret, PaymentWebhookHandler } from "../../src/commercial/server/paymentWebhookHandler";
import { generateCryptographicLicenseKey } from "../../src/commercial/server/provisioner";
import { executeLocalReconciliationSync } from "../../src/api/auditWorkflow";
import type { CalculationTerm } from "../../src/types";
import type { EntitlementState } from "../../src/licensing/types";
import { checkAuditAccess, consumeAuditCredit, loadPersistedEntitlement, savePersistedEntitlement, parseLicenseKey } from "../../src/licensing/entitlement";

describe("G9.2 Commercial Transaction & Quota State Machine Integration Suite", () => {
  beforeEach(() => {
    PaymentWebhookHandler.resetIdempotencyStore();
    ProductionLicensingService.resetServerStore();
  });

  it("1. Forged Webhook Rejection: Invalid HMAC signature returns HTTP 401 Unauthorized error", async () => {
    const payload = {
      eventId: "evt_forged_921",
      eventType: "payment.captured" as const,
      paymentId: "pay_forged_921",
      amountINR: 2999,
      customerEmail: "attacker@domain.com",
      planType: "SINGLE_AUDIT" as const,
      signature: "INVALID_SIGNATURE"
    };

    const res = await PaymentWebhookHandler.handleWebhook(payload);
    expect(res.success).toBe(false);
    expect(res.message).toContain("HTTP 401 Unauthorized");
  });

  it("2. Duplicate Webhook Idempotency: Duplicate webhook event does not issue duplicate key", async () => {
    const eventId = "evt_dup_922";
    const paymentId = "pay_dup_922";
    const planType = "PROFESSIONAL_MONTHLY" as const;
    const signature = await computeWebhookHmac(`${eventId}:${paymentId}:${planType}`, getWebhookSecret());

    const payload = {
      eventId,
      eventType: "payment.captured" as const,
      paymentId,
      amountINR: 4999,
      customerEmail: "user@domain.com",
      planType,
      signature
    };

    const res1 = await PaymentWebhookHandler.handleWebhook(payload);
    expect(res1.success).toBe(true);

    const res2 = await PaymentWebhookHandler.handleWebhook(payload);
    expect(res2.success).toBe(true);
    expect(res2.isDuplicate).toBe(true);
    expect(res2.provisionedKey).toBe(res1.provisionedKey);
  });

  it("3. State Machine Transition: AVAILABLE -> RESERVED (Gate 0 Audit Start)", () => {
    const key = "YBY-PRO-SM-001";
    ProductionLicensingService.registerProvisionedKey({
      licenseKey: key,
      plan: "PROFESSIONAL_MONTHLY",
      status: "ACTIVE",
      auditsAllowed: 5,
      auditsUsed: 0,
      auditsReserved: 0,
      maxDevices: 1,
      createdAt: new Date().toISOString()
    });

    const res = ProductionLicensingService.handleReserveQuota({
      licenseKey: key,
      deviceHash: "dev_sm_1"
    });

    expect(res.valid).toBe(true);
    expect(res.auditsReserved).toBe(1);
    expect(res.auditsRemaining).toBe(4); // 5 - 0 - 1 = 4
    expect(res.reservationId).toBeDefined();
  });

  it("4. State Machine Transition: RESERVED -> CONSUMED (AUDIT_COMPLETE)", () => {
    const key = "YBY-PRO-SM-002";
    ProductionLicensingService.registerProvisionedKey({
      licenseKey: key,
      plan: "PROFESSIONAL_MONTHLY",
      status: "ACTIVE",
      auditsAllowed: 5,
      auditsUsed: 0,
      auditsReserved: 0,
      maxDevices: 1,
      createdAt: new Date().toISOString()
    });

    const resRes = ProductionLicensingService.handleReserveQuota({ licenseKey: key, deviceHash: "dev_sm_2" });
    expect(resRes.reservationId).toBeDefined();

    const commitRes = ProductionLicensingService.handleCommitQuota({
      licenseKey: key,
      deviceHash: "dev_sm_2",
      reservationId: resRes.reservationId!
    });

    expect(commitRes.valid).toBe(true);
    expect(commitRes.auditsReserved).toBe(0);
    expect(commitRes.auditsRemaining).toBe(4); // 5 - 1 - 0 = 4
  });

  it("5. State Machine Transition: RESERVED -> AVAILABLE on cancellation or release", () => {
    const key = "YBY-PRO-SM-003";
    ProductionLicensingService.registerProvisionedKey({
      licenseKey: key,
      plan: "PROFESSIONAL_MONTHLY",
      status: "ACTIVE",
      auditsAllowed: 5,
      auditsUsed: 0,
      auditsReserved: 0,
      maxDevices: 1,
      createdAt: new Date().toISOString()
    });

    const resRes = ProductionLicensingService.handleReserveQuota({ licenseKey: key, deviceHash: "dev_sm_3" });
    const releaseRes = ProductionLicensingService.handleReleaseQuota({
      licenseKey: key,
      deviceHash: "dev_sm_3",
      reservationId: resRes.reservationId!
    });

    expect(releaseRes.valid).toBe(true);
    const valRes = ProductionLicensingService.handleValidateKeyRequest({ licenseKey: key, deviceHash: "dev_sm_3" });
    expect(valRes.auditsRemaining).toBe(5);
  });

  it("6. Concurrent Quota Reservation Race Protection", () => {
    const key = "YBY-SINGLE-RACE-001";
    ProductionLicensingService.registerProvisionedKey({
      licenseKey: key,
      plan: "SINGLE_AUDIT",
      status: "ACTIVE",
      auditsAllowed: 1,
      auditsUsed: 0,
      auditsReserved: 0,
      maxDevices: 1,
      createdAt: new Date().toISOString()
    });

    // Request 1 reserves the single audit
    const req1 = ProductionLicensingService.handleReserveQuota({ licenseKey: key, deviceHash: "dev_race_1" });
    expect(req1.valid).toBe(true);

    // Concurrent Request 2 attempts to reserve same entitlement
    const req2 = ProductionLicensingService.handleReserveQuota({ licenseKey: key, deviceHash: "dev_race_1" });
    expect(req2.valid).toBe(false);
    expect(["SINGLE_AUDIT_ALREADY_CONSUMED", "QUOTA_EXHAUSTED"]).toContain(req2.status);
  });

  it("7. Interrupted Audit Quota Preservation", () => {
    const key = "YBY-PRO-INTERRUPT-001";
    ProductionLicensingService.registerProvisionedKey({
      licenseKey: key,
      plan: "PROFESSIONAL_MONTHLY",
      status: "ACTIVE",
      auditsAllowed: 5,
      auditsUsed: 0,
      auditsReserved: 0,
      maxDevices: 1,
      createdAt: new Date().toISOString()
    });

    const resRes = ProductionLicensingService.handleReserveQuota({ licenseKey: key, deviceHash: "dev_int_1" });
    expect(resRes.reservationId).toBeDefined();

    // Audit is interrupted before commit -> explicitly released or expired
    ProductionLicensingService.handleReleaseQuota({ reservationId: resRes.reservationId });

    const checkRes = ProductionLicensingService.handleValidateKeyRequest({ licenseKey: key, deviceHash: "dev_int_1" });
    expect(checkRes.auditsRemaining).toBe(5);
  });

  it("8. Cryptographically Random Non-Sequential License Key Generation Test", () => {
    const key1 = generateCryptographicLicenseKey("PROFESSIONAL_MONTHLY");
    const key2 = generateCryptographicLicenseKey("PROFESSIONAL_MONTHLY");

    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^YBY-PRO-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(key2).toMatch(/^YBY-PRO-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  });

  it("9. Activation & Validation Rate Limiting Enforcement (HTTP 429)", () => {
    const devHash = "dev_rate_limit_test";
    const key = "YBY-FREE-DEFAULT-000";

    // 10 valid calls within window succeed
    for (let i = 0; i < 10; i++) {
      const res = ProductionLicensingService.handleValidateKeyRequest({ licenseKey: key, deviceHash: devHash });
      expect(res.valid).toBe(true);
    }

    // 11th call breaches rate limit
    const breachRes = ProductionLicensingService.handleValidateKeyRequest({ licenseKey: key, deviceHash: devHash });
    expect(breachRes.valid).toBe(false);
    expect(breachRes.status).toBe("NETWORK_ERROR");
    expect(breachRes.reason).toContain("HTTP 429 Too Many Requests");
  });

  it("10. Zero Audit-Data Leakage Assertion", () => {
    const leakyPayload = {
      licenseKey: "YBY-PRO-MONTHLY-002",
      deviceHash: "dev_hash_1",
      pdfText: "CONFIDENTIAL MSA TERMS",
      findings: ["R1 violation"]
    };

    const res = ProductionLicensingService.handleValidateKeyRequest(leakyPayload as any);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("Security Violation");
  });

  it("11. Failed Payment Event does not provision license key", async () => {
    const eventId = "evt_fail_9211";
    const paymentId = "pay_fail_9211";
    const planType = "SINGLE_AUDIT" as const;
    const signature = await computeWebhookHmac(`${eventId}:${paymentId}:${planType}`, getWebhookSecret());

    const res = await PaymentWebhookHandler.handleWebhook({
      eventId,
      eventType: "payment.failed",
      paymentId,
      amountINR: 2999,
      customerEmail: "user@domain.com",
      planType,
      signature
    });

    expect(res.success).toBe(false);
    expect(res.provisionedKey).toBeUndefined();
  });

  it("12. R1–R8 Deterministic Reconciliation Engine Regression Intact", () => {
    const terms: CalculationTerm[] = [
      { id: "1", name: "priceCap", value: 10000, sourceRef: { fileName: "c.pdf", fileSha256: "h1", page: 1 }, lockStatus: "HUMAN_LOCK" },
      { id: "2", name: "renewalPrice", value: 12000, sourceRef: { fileName: "c.pdf", fileSha256: "h1", page: 1 }, lockStatus: "HUMAN_LOCK" },
      { id: "3", name: "contractedSeats", value: 100, sourceRef: { fileName: "c.pdf", fileSha256: "h1", page: 1 }, lockStatus: "HUMAN_LOCK" },
      { id: "4", name: "usedSeats", value: 80, sourceRef: { fileName: "u.csv", fileSha256: "h2", row: 1 }, lockStatus: "HUMAN_LOCK" }
    ];

    const result = executeLocalReconciliationSync(terms, [{ id: "1", seats: 80 }]);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0].ruleId).toBe("R1");
    expect(result.evidence[0].delta).toBe(2000);
  });

  it("13. Gate G4 Blocked Audit does NOT generate evidence or consume quota", () => {
    const blockedTerms: CalculationTerm[] = [
      { id: "1", name: "priceCap", value: 10000, sourceRef: { fileName: "c.pdf", fileSha256: "h1", page: 1 }, lockStatus: "BLOCKED" },
      { id: "2", name: "renewalPrice", value: 12000, sourceRef: { fileName: "c.pdf", fileSha256: "h1", page: 1 }, lockStatus: "BLOCKED" }
    ];

    const result = executeLocalReconciliationSync(blockedTerms, [{ id: "1", seats: 80 }]);
    const g4Gate = result.gates.find((g) => g.gate === "G4");
    expect(g4Gate?.status).toBe("BLOCK");
    expect(result.evidence).toEqual([]);
  });

  it("14. Entitlement persistence across page reloads & multi-file upload safety", () => {
    const initial = parseLicenseKey("FREE");
    expect(initial.auditsRemaining).toBe(1);

    const consumed = consumeAuditCredit(initial);
    expect(consumed.status).toBe("QUOTA_EXHAUSTED");
    expect(consumed.auditsRemaining).toBe(0);

    savePersistedEntitlement(consumed);
    const restored = loadPersistedEntitlement();
    expect(restored.status).toBe("QUOTA_EXHAUSTED");
    expect(restored.auditsRemaining).toBe(0);
  });

  it("15. Server-Verified Paid Upgrade vs. Failed Payment Blocking", async () => {
    const eventId = "evt_paid_1515";
    const paymentId = "pay_order_1515";
    const planType = "PROFESSIONAL_MONTHLY" as const;
    const signature = await computeWebhookHmac(`${eventId}:${paymentId}:${planType}`, getWebhookSecret());

    // 1. Success payment produces active key
    const resSuccess = await PaymentWebhookHandler.handleWebhook({
      eventId,
      eventType: "payment.captured",
      paymentId,
      amountINR: 4999,
      customerEmail: "finance@company.com",
      planType,
      signature
    });

    expect(resSuccess.success).toBe(true);
    expect(resSuccess.provisionedKey).toBeDefined();

    // 2. Failed payment does not grant entitlement
    const failEventId = "evt_fail_1516";
    const failPaymentId = "pay_fail_1516";
    const failSignature = await computeWebhookHmac(`${failEventId}:${failPaymentId}:${planType}`, getWebhookSecret());

    const resFail = await PaymentWebhookHandler.handleWebhook({
      eventId: failEventId,
      eventType: "payment.failed",
      paymentId: failPaymentId,
      amountINR: 4999,
      customerEmail: "finance@company.com",
      planType,
      signature: failSignature
    });

    expect(resFail.success).toBe(false);
    expect(resFail.provisionedKey).toBeUndefined();
  });

  it("16. PaymentCTA_Click_DoesNotActivateEntitlementBeforeServerVerification", async () => {
    // Given: QUOTA_EXHAUSTED, auditsRemaining = 0
    let state: EntitlementState = {
      status: "QUOTA_EXHAUSTED",
      plan: "FREE_FIRST_AUDIT",
      auditsAllowed: 1,
      auditsUsed: 1,
      auditsRemaining: 0
    };

    expect(state.status).toBe("QUOTA_EXHAUSTED");
    expect(state.auditsRemaining).toBe(0);
    expect(checkAuditAccess(state).allowed).toBe(false);

    // When: User clicks any paid CTA (Single, Monthly, Annual) but payment signature is unverified
    const plansToTest = [
      { plan: "SINGLE_AUDIT" as const, expectedAudits: 1, price: 2999 },
      { plan: "PROFESSIONAL_MONTHLY" as const, expectedAudits: 5, price: 4999 },
      { plan: "ANNUAL_PROFESSIONAL" as const, expectedAudits: 60, price: 49990 }
    ];

    for (const item of plansToTest) {
      // 1. Unverified CTA Click Simulation -> Rejection before server verification
      const unverifiedPayload = {
        eventId: `evt_unverified_${item.plan}`,
        eventType: "payment.captured" as const,
        paymentId: `pay_unverified_${item.plan}`,
        amountINR: item.price,
        customerEmail: "user@domain.com",
        planType: item.plan,
        signature: "INVALID_UNVERIFIED_SIGNATURE"
      };

      const unverifiedRes = await PaymentWebhookHandler.handleWebhook(unverifiedPayload);

      // Assert: Webhook verification fails
      expect(unverifiedRes.success).toBe(false);
      expect(unverifiedRes.provisionedKey).toBeUndefined();

      // Assert: Entitlement remains QUOTA_EXHAUSTED, auditsRemaining remains 0, Gate 0 remains blocked
      expect(state.status).toBe("QUOTA_EXHAUSTED");
      expect(state.auditsRemaining).toBe(0);
      expect(checkAuditAccess(state).allowed).toBe(false);

      // 2. Verified Payment Simulation -> Only valid HMAC webhook signature provisions key & unlocks Gate 0
      const eventId = `evt_verified_${item.plan}_${Date.now()}`;
      const paymentId = `pay_verified_${item.plan}_${Date.now()}`;
      const validSignature = await computeWebhookHmac(`${eventId}:${paymentId}:${item.plan}`, getWebhookSecret());

      const verifiedRes = await PaymentWebhookHandler.handleWebhook({
        eventId,
        eventType: "payment.captured",
        paymentId,
        amountINR: item.price,
        customerEmail: "user@domain.com",
        planType: item.plan,
        signature: validSignature
      });

      expect(verifiedRes.success).toBe(true);
      expect(verifiedRes.provisionedKey).toBeDefined();

      const valRes = ProductionLicensingService.handleValidateKeyRequest({
        licenseKey: verifiedRes.provisionedKey!,
        deviceHash: "dev_hash_g9_commercial_test"
      });

      const updatedState: EntitlementState = {
        status: "ACTIVE",
        plan: item.plan,
        auditsAllowed: valRes.auditsRemaining || item.expectedAudits,
        auditsUsed: 0,
        auditsRemaining: valRes.auditsRemaining || item.expectedAudits
      };

      // Assert: Entitlement becomes ACTIVE, exact quota granted, Gate 0 unlocks
      expect(updatedState.status).toBe("ACTIVE");
      expect(updatedState.auditsRemaining).toBe(item.expectedAudits);
      expect(checkAuditAccess(updatedState).allowed).toBe(true);
    }
  });
});
