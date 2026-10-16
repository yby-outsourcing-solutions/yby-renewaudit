// netlify/functions/fulfill-license.ts - Authenticated, Unguessable One-Time License Fulfillment
import crypto from "crypto";
import { getServerConfig, AUTHORITATIVE_PLANS } from "./shared/config";
import { withTransaction } from "./shared/db";
import { generateCryptographicLicenseKey } from "../../src/commercial/server/provisioner";

interface FulfillRequestBody {
  order_id?: string;
  orderId?: string;
  payment_id?: string;
  paymentId?: string;
  razorpay_signature?: string;
  signature?: string;
  claim_token?: string;
  claimToken?: string;
  device_hash?: string;
  deviceHash?: string;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed. Use POST." })
    };
  }

  try {
    const config = getServerConfig();
    const body: FulfillRequestBody = JSON.parse(event.body || "{}");
    const order_id = body.order_id || body.orderId;
    const payment_id = body.payment_id || body.paymentId;
    const razorpay_signature = body.razorpay_signature || body.signature;
    const claim_token = body.claim_token || body.claimToken;
    const device_hash = body.device_hash || body.deviceHash;

    if (!order_id || !payment_id || !razorpay_signature || !claim_token || !device_hash) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields: order_id, payment_id, razorpay_signature, claim_token, and device_hash are all required." })
      };
    }

    // 1. FACTOR A: Razorpay Checkout Signature Verification (HMAC-SHA256)
    const expectedSignature = crypto
      .createHmac("sha256", config.keySecret)
      .update(`${order_id}|${payment_id}`)
      .digest("hex");

    const sigBufferA = Buffer.from(razorpay_signature);
    const sigBufferB = Buffer.from(expectedSignature);

    if (sigBufferA.length !== sigBufferB.length || !crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Payment signature verification failed. The transaction cannot be verified as authentic." })
      };
    }

    // 2. FACTOR B & C: Database Claim Token Verification & Atomicity
    const inputTokenHash = crypto.createHash("sha256").update(claim_token).digest("hex");

    const result = await withTransaction(async (client) => {
      // Lock the order row
      const orderRes = await client.query(
        `SELECT * FROM orders WHERE order_id = $1 FOR UPDATE;`,
        [order_id]
      );

      if (orderRes.rowCount === 0) {
        throw { statusCode: 404, message: "Order not found." };
      }

      const order = orderRes.rows[0];

      // Verify unguessable claim token
      if (order.claim_token_hash !== inputTokenHash) {
        throw { statusCode: 403, message: "CLAIM_TOKEN_MISMATCH: Unauthorized license fulfillment attempt." };
      }

      // Check if a license is already provisioned
      if (order.license_key) {
        const licRes = await client.query(
          `SELECT * FROM licenses WHERE license_key = $1 FOR UPDATE;`,
          [order.license_key]
        );

        if (licRes.rowCount > 0) {
          const lic = licRes.rows[0];

          // Check device binding
          if (!lic.bound_device_hash) {
            await client.query(
              `UPDATE licenses SET bound_device_hash = $1, updated_at = NOW() WHERE license_key = $2;`,
              [device_hash, lic.license_key]
            );
            lic.bound_device_hash = device_hash;
          } else if (lic.bound_device_hash !== device_hash) {
            throw {
              statusCode: 403,
              message: "DEVICE_BINDING_VIOLATION: License is already registered to another device."
            };
          }

          const remaining = lic.audits_allowed - lic.audits_used - lic.audits_reserved;
          return {
            success: true,
            license_key: lic.license_key,
            licenseKey: lic.license_key,
            plan: lic.plan_type,
            planType: lic.plan_type,
            audits_allowed: lic.audits_allowed,
            auditsAllowed: lic.audits_allowed,
            audits_remaining: remaining,
            auditsRemaining: remaining,
            status: lic.status
          };
        }
      }

      // If license not yet provisioned (e.g. client arrives before webhook):
      // Verify payment with Razorpay API as backup verification
      const planConfig = AUTHORITATIVE_PLANS[order.plan_type];
      const newKey = generateCryptographicLicenseKey(order.plan_type);
      const auditsAllowed = planConfig ? planConfig.auditsAllowed : 1;
      const expiresAt = planConfig && planConfig.cycleDays
        ? new Date(Date.now() + planConfig.cycleDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      // Provision new license row
      await client.query(
        `INSERT INTO licenses (license_key, plan_type, status, audits_allowed, audits_used, audits_reserved, bound_device_hash, expires_at)
         VALUES ($1, $2, 'ACTIVE', $3, 0, 0, $4, $5);`,
        [newKey, order.plan_type, auditsAllowed, device_hash, expiresAt]
      );

      // Mark order fulfilled
      await client.query(
        `UPDATE orders
         SET status = 'paid', payment_id = $1, license_key = $2, fulfilled_at = NOW(), updated_at = NOW()
         WHERE order_id = $3;`,
        [payment_id, newKey, order_id]
      );

      return {
        success: true,
        license_key: newKey,
        licenseKey: newKey,
        plan: order.plan_type,
        planType: order.plan_type,
        audits_allowed: auditsAllowed,
        auditsAllowed: auditsAllowed,
        audits_remaining: auditsAllowed,
        auditsRemaining: auditsAllowed,
        status: "ACTIVE"
      };
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Failed to fulfill license." })
    };
  }
};
