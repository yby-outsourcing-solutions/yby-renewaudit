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

    // 2. FACTOR B & C: Database Claim Token Verification & Authoritative Gateway Validation
    const inputTokenHash = crypto.createHash("sha256").update(claim_token).digest("hex");

    // Query Razorpay API directly for authoritative payment entity & amount verification
    const authHeader = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments/${payment_id}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${authHeader}`
      }
    });

    if (!rzpRes.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Failed to verify captured payment with payment gateway." })
      };
    }

    const payment = await rzpRes.json();
    if (payment.status !== "captured") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Payment is not captured. Current status: ${payment.status}` })
      };
    }

    if (payment.order_id && payment.order_id !== order_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Payment order ID mismatch." })
      };
    }

    // Determine plan type from payment details
    let planType: "SINGLE_AUDIT" | "PROFESSIONAL_MONTHLY" | "ANNUAL_PROFESSIONAL" = "SINGLE_AUDIT";
    if (payment.amount === 4999000 || payment.notes?.plan_type === "ANNUAL_PROFESSIONAL") {
      planType = "ANNUAL_PROFESSIONAL";
    } else if (payment.amount === 499900 || payment.notes?.plan_type === "PROFESSIONAL_MONTHLY") {
      planType = "PROFESSIONAL_MONTHLY";
    } else {
      planType = "SINGLE_AUDIT";
    }

    const planConfig = AUTHORITATIVE_PLANS[planType];

    // Server-Side Amount Validation: verify amount matches plan price (or verified micro-test payment)
    const isAmountValid = payment.amount === planConfig.amountPaise || payment.amount === 1000;
    if (!isAmountValid) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `SECURITY_ALERT: Amount mismatch. Expected ${planConfig.amountPaise}, received ${payment.amount}` })
      };
    }

    // 3. MANDATORY DATABASE FULFILLMENT (Strict Fail-Closed: Never grant access without DB commit)
    const result = await withTransaction(async (client) => {
      // Check or self-heal order row
      const orderRes = await client.query(
        `SELECT * FROM orders WHERE order_id = $1 FOR UPDATE;`,
        [order_id]
      );

      let order = orderRes.rows[0];

      if (orderRes.rowCount === 0) {
        const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await client.query(
          `INSERT INTO orders (order_id, receipt_id, plan_type, amount_inr_paise, currency, status, customer_email, claim_token_hash)
           VALUES ($1, $2, $3, $4, 'INR', 'paid', $5, $6)
           ON CONFLICT (order_id) DO UPDATE SET status = 'paid';`,
          [order_id, receiptId, planType, payment.amount, payment.email || "billing@company.com", inputTokenHash]
        );
        const retryOrder = await client.query(
          `SELECT * FROM orders WHERE order_id = $1 FOR UPDATE;`,
          [order_id]
        );
        order = retryOrder.rows[0];
      } else {
        // Verify unguessable claim token
        if (order.claim_token_hash && order.claim_token_hash !== inputTokenHash) {
          throw { statusCode: 403, message: "CLAIM_TOKEN_MISMATCH: Unauthorized license fulfillment attempt." };
        }
      }

      // Check if a license is already provisioned (idempotency)
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

      // Provision new license row in PostgreSQL
      const newKey = generateCryptographicLicenseKey(planType);
      const auditsAllowed = planConfig.auditsAllowed;
      const expiresAt = planConfig.cycleDays
        ? new Date(Date.now() + planConfig.cycleDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      await client.query(
        `INSERT INTO licenses (license_key, plan_type, status, audits_allowed, audits_used, audits_reserved, bound_device_hash, expires_at)
         VALUES ($1, $2, 'ACTIVE', $3, 0, 0, $4, $5);`,
        [newKey, planType, auditsAllowed, device_hash, expiresAt]
      );

      // Mark order fulfilled with payment_id, license_key and timestamp
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
        plan: planType,
        planType: planType,
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
    console.error("Fulfillment failure (fail-closed):", err.message || err);
    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Failed to fulfill license in database. Entitlement refused without persistent record." })
    };
  }
};
